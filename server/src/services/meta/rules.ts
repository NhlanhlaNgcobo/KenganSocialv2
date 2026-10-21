import admin from 'firebase-admin';
import { CHAT_MODEL, chatClient } from '../llm-client.js';
import { processLeadScore } from '../leads/scoreService';
import { workspaceRef, type MetaChannel } from './messaging';

/**
 * Automation rules (workspaces/{id}/automations, managed on the Automations page) and the AI reply
 * suggestion shared by Instagram and Facebook messages and comments.
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

/** Active rules of this trigger type that apply to this platform and whose keywords appear in the text. */
export async function matchingRules(workspaceId: string, triggerType: TriggerType, platform: MetaChannel, text: string): Promise<Rule[]> {
    const lower = text.toLowerCase();
    const snap = await workspaceRef(workspaceId).collection('automations').where('status', '==', 'active').get();
    return snap.docs
        .map((d) => ({ id: d.id, ref: d.ref, ...(d.data() as any) }) as Rule)
        .filter((rule) => rule.trigger?.type === triggerType)
        .filter((rule) => !Array.isArray(rule.connections) || rule.connections.length === 0 || rule.connections.includes(platform))
        .filter((rule) => (rule.trigger.config?.keywords || []).some((k) => k && lower.includes(String(k).toLowerCase())));
}

export async function countRun(rule: Rule) {
    await rule.ref.update({ runCount: admin.firestore.FieldValue.increment(1), lastRunAt: admin.firestore.FieldValue.serverTimestamp() });
}

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
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
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
