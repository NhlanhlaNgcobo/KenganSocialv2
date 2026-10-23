import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../../utils/firestore';
import { CHAT_MODEL, chatClient } from '../llm-client.js';
import { processLeadScore } from '../leads/scoreService';
import { DmError, workspaceRef, type MetaChannel } from './messaging';

/**
 * Automation rules (workspaces/{id}/automations, managed on the Automations page) and the AI reply
 * suggestion shared by Instagram and Facebook messages and comments.
 *
 * Every rule run is claimed in workspaces/{id}/automationRuns/{rule}_{platform}_{person} (claimRun):
 *  - idempotent: a webhook event retried by the dispatcher never repeats a step that already succeeded;
 *  - cooldown: a rule acts at most once per person per RULE_COOLDOWN_MS, so a keyword doesn't fire on
 *    every message from the same person.
 * The claim docs carry an expireAt for a Firestore TTL policy (firestore.indexes.json), so they are
 * removed after RUN_RETENTION_MS.
 */

export type TriggerType = 'dm_keyword' | 'comment_keyword';

export interface Rule {
    id: string;
    name: string;
    trigger: { type: TriggerType; config: { keywords: string[] } };
    action: { type: string; config: { message?: string; publicReply?: string } };
    connections: string[];
    ref: FirebaseFirestore.DocumentReference;
}

// ─── Keyword matching ────────────────────────────────────────────────────────────────────────────

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORD = '[\\p{L}\\p{M}\\p{N}_]';

/**
 * Whether the keyword appears in the text as a whole word or phrase: case-insensitive and
 * Unicode-aware, so "hi" matches "Hi!" and "hi there" but not "this", and "café" matches "Café?".
 * A multi-word keyword matches the phrase with any spacing ("price list" in "PRICE   list please").
 */
export function keywordMatches(text: string, keyword: string) {
    const k = String(keyword || '').normalize('NFKC').trim();
    if (!k) return false;
    const body = k.split(/\s+/).map(escapeRegExp).join('\\s+');
    // Only require a boundary where the keyword itself starts/ends with a word character ("#sale", "50%" still work).
    const start = new RegExp(`^${WORD}`, 'u').test(k) ? `(?<!${WORD})` : '';
    const end = new RegExp(`${WORD}$`, 'u').test(k) ? `(?!${WORD})` : '';
    return new RegExp(`${start}${body}${end}`, 'iu').test(String(text || '').normalize('NFKC'));
}

export const matchesAnyKeyword = (text: string, keywords: unknown[]) => (keywords || []).some((k) => typeof k === 'string' && keywordMatches(text, k));

/** Active rules of this trigger type that apply to this platform and whose keywords appear in the text. */
export async function matchingRules(workspaceId: string, triggerType: TriggerType, platform: MetaChannel, text: string): Promise<Rule[]> {
    const snap = await workspaceRef(workspaceId).collection('automations').where('status', '==', 'active').get();
    return snap.docs
        .map((d) => ({ id: d.id, ref: d.ref, ...(d.data() as any) }) as Rule)
        .filter((rule) => rule.trigger?.type === triggerType)
        .filter((rule) => !Array.isArray(rule.connections) || rule.connections.length === 0 || rule.connections.includes(platform))
        .filter((rule) => matchesAnyKeyword(text, rule.trigger.config?.keywords || []));
}

// ─── Run claims: idempotency and per-person cooldown ─────────────────────────────────────────────

/** A rule acts at most once per person in this period. */
export const RULE_COOLDOWN_MS = 24 * 3600 * 1000;
/** A claim not completed within this time (all retries failed, or a crash) no longer blocks the person. */
export const STALE_CLAIM_MS = 2 * 3600 * 1000;
/** Claim docs are kept this long (Firestore TTL on expireAt), then deleted. */
const RUN_RETENTION_MS = 30 * 86400 * 1000;

export interface RunRecord {
    eventKey?: string;
    claimedAt?: number;
    doneAt?: number | null;
    steps?: Record<string, boolean>;
}

export type ClaimDecision = 'run' | 'done' | 'cooldown';

/**
 * Pure decision for a rule run:
 *  - the same event again (a retry): 'done' if it finished, otherwise 'run' (only the missing steps run);
 *  - another event within the cooldown of a finished run, or while a recent claim is in flight: 'cooldown';
 *  - otherwise 'run' (a new claim).
 */
export function decideClaim(existing: RunRecord | null | undefined, eventKey: string, now: number, cooldownMs = RULE_COOLDOWN_MS, staleMs = STALE_CLAIM_MS): ClaimDecision {
    if (!existing || !existing.claimedAt) return 'run';
    if (existing.eventKey === eventKey) return existing.doneAt ? 'done' : 'run';
    if (existing.doneAt) return now - existing.doneAt < cooldownMs ? 'cooldown' : 'run';
    return now - existing.claimedAt < staleMs ? 'cooldown' : 'run';
}

export interface RunClaim {
    decision: ClaimDecision;
    ref: FirebaseFirestore.DocumentReference;
    steps: Record<string, boolean>;
}

const safeId = (s: string) => String(s).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 300);

export const runRef = (workspaceId: string, ruleKey: string, platform: MetaChannel, personId: string) =>
    workspaceRef(workspaceId).collection('automationRuns').doc(safeId(`${ruleKey}_${platform}_${personId}`));

/** Claims a rule run for this event and person in a transaction (two deliveries can't both claim it). */
export async function claimRun(workspaceId: string, ruleKey: string, platform: MetaChannel, personId: string, eventKey: string, now = Date.now()): Promise<RunClaim> {
    const ref = runRef(workspaceId, ruleKey, platform, personId);
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const existing = (snap.exists ? snap.data() : null) as RunRecord | null;
        const decision = decideClaim(existing, eventKey, now);
        const sameEvent = existing?.eventKey === eventKey;
        if (decision === 'run') {
            tx.set(ref, {
                ruleKey,
                platform,
                personId,
                eventKey,
                claimedAt: sameEvent ? existing!.claimedAt : now,
                doneAt: null,
                steps: sameEvent ? existing!.steps || {} : {},
                expireAt: Timestamp.fromMillis(now + RUN_RETENTION_MS),
            });
        }
        return { decision, ref, steps: (sameEvent && existing?.steps) || {} };
    });
}

export async function markStep(claim: RunClaim, step: string) {
    claim.steps[step] = true;
    await claim.ref.update({ [`steps.${step}`]: true });
}

export async function completeRun(claim: RunClaim) {
    await claim.ref.update({ doneAt: Date.now() });
}

/** A run that failed for good (window closed, opted out…): free the person so a later message can try again. */
export async function releaseRun(claim: RunClaim) {
    await claim.ref.delete().catch(() => {});
}

// ─── Rule bookkeeping ────────────────────────────────────────────────────────────────────────────

export async function countRun(rule: Pick<Rule, 'ref'>) {
    await rule.ref.update({ runCount: FieldValue.increment(1), lastRunAt: FieldValue.serverTimestamp(), lastError: null });
}

/** Shown on the Automations page: the last failure and how many there have been. */
export async function recordRuleFailure(ref: FirebaseFirestore.DocumentReference, error: unknown) {
    const message = String((error as Error)?.message || error).slice(0, 300);
    await ref.update({ lastError: message, lastErrorAt: Date.now(), failureCount: FieldValue.increment(1) }).catch(() => {});
}

/** Should a failed step make the webhook event retry? DmErrors say so; unknown errors (Firestore, bugs) do. */
export const isRetryable = (error: unknown) => (error instanceof DmError ? error.retryable : true);

/** Adds the person to Leads once per platform account. */
export async function addLead(workspaceId: string, platform: MetaChannel, person: { id: string; name?: string; username?: string }, source: string) {
    const leads = workspaceRef(workspaceId).collection('leads');
    const existing = await leads.where('externalId', '==', person.id).limit(5).get();
    if (existing.docs.some((d) => (d.data().platform || 'instagram') === platform)) return false;
    await leads.add(
        processLeadScore({
            externalId: person.id,
            username: person.username || person.name || person.id,
            displayName: person.name || person.username || (platform === 'instagram' ? 'Instagram user' : 'Facebook user'),
            platform,
            followersCount: 0,
            status: 'prospect',
            tags: ['automation'],
            source,
            signals: { totalLikes: 0, totalComments: 0, storyReply: false } as any,
            createdAt: FieldValue.serverTimestamp(),
        } as any)
    );
    return true;
}

const SAFE_FALLBACK = 'Thanks for your message! Let me check and get back to you shortly.';

/**
 * Facts the model can't know (prices, discounts, links, phone numbers, dates and times) that are not
 * in the person's own message. A suggestion containing any is replaced with SAFE_FALLBACK.
 */
const FACT_PATTERNS = [
    /(?:\bR|\$|€|£|ZAR|USD)\s?\d/i, // prices
    /\d+\s?%/, // discounts
    /https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|co\.za|net|org|io|shop|store)\b/i, // links
    /(?:\+?\d[\s-]?){7,}/, // phone numbers
    /\b\d{1,2}[:h]\d{2}\b|\b\d{1,2}\s?(?:am|pm)\b/i, // times
    /\b\d{1,2}\s(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i, // dates
];

export function hasUnverifiedFacts(suggestion: string, original: string) {
    return FACT_PATTERNS.some((re) => re.test(suggestion) && !re.test(original));
}

/**
 * A draft reply for the approval queue. The account owner always reviews it before it is sent, and
 * it never states facts the model can't know: those are left for the owner to fill in.
 */
export async function suggestReply(text: string, platform: MetaChannel) {
    try {
        const aiRes = await chatClient.chat.completions.create({
            model: CHAT_MODEL,
            messages: [
                {
                    role: 'system',
                    content: [
                        `You draft a reply to a message sent to a business or creator's ${platform === 'instagram' ? 'Instagram' : 'Facebook Page'} account. The owner reviews your draft before it is sent.`,
                        'Write one short, friendly reply in the language of the message.',
                        'You know nothing about this business. Never state or guess prices, discounts, stock, availability, delivery times, dates, opening hours, addresses, links, phone numbers, policies or promises.',
                        'If the message asks for any of these, thank them and say you will get back to them with the details, or ask one short clarifying question.',
                        'Do not claim to have done anything. Reply with the message text only.',
                    ].join(' '),
                },
                { role: 'user', content: text.slice(0, 2000) },
            ],
        });
        const draft = aiRes.choices[0]?.message?.content?.trim() || '';
        if (!draft) return '';
        return hasUnverifiedFacts(draft, text) ? SAFE_FALLBACK : draft.slice(0, 1000);
    } catch (error) {
        console.warn('[Messaging] AI reply suggestion failed:', (error as Error).message);
        return '';
    }
}
