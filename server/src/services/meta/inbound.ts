import { FieldValue } from 'firebase-admin/firestore';
import { findConnections } from '../connection-lookup';
import {
    DmError,
    OPT_OUT_WORDS,
    REPLY_WINDOW_MS,
    fillPlaceholders,
    handoverUntil,
    isOptedOut,
    isOwnEcho,
    optOut,
    recordInbound,
    sendDM,
    senderProfile,
    startHandover,
    threadRef,
    workspaceRef,
    type MetaChannel,
} from './messaging';
import { isOwnMessage } from './send-guard';
import { automationsEnabled, hasLeads, hasQueue, workspacePlan } from './plan-access';
import {
    addLead,
    claimRun,
    completeRun,
    countRun,
    isRetryable,
    keywordMatches,
    markStep,
    matchingRules,
    recordRuleFailure,
    releaseRun,
    suggestReply,
    type RunClaim,
} from './rules';

/**
 * One incoming Instagram DM or Facebook Messenger message (webhook events instagram.message and
 * page.message, via services/webhooks). entry.id is the Instagram professional account id or the
 * Page id, which is the connection's accountId.
 *
 * Order: record the message (opens the 24-hour reply window), honour opt-outs, skip automation while
 * the owner has taken over the conversation, run the Automations page rules, then Inbox auto-replies;
 * otherwise queue an AI-suggested reply for the owner to approve (plans with the queue only).
 *
 * Echoes (messages the account sent) are not answered: one the owner typed by hand pauses automation
 * in that conversation for HANDOVER_MS.
 *
 * Retries: a send that fails for a temporary reason is rethrown so the webhook dispatcher retries the
 * event. Each rule run is claimed per event (rules.ts claimRun), so a retry never sends twice, and the
 * queue entry is keyed by the event, so it is never added twice.
 * Returns the workspace it belonged to, or null if no workspace has this account.
 */
export async function handleMetaMessage(platform: MetaChannel, accountId: string, event: any, eventKey: string): Promise<string | null> {
    if (event.message?.is_echo) return handleEcho(platform, accountId, event);
    const senderId = String(event.sender?.id || '');
    if (!senderId || senderId === accountId) return null;

    const [match] = await findConnections('accountId', accountId, [platform]);
    if (!match) {
        console.log(`[Messaging] No workspace is connected to ${platform} account ${accountId}`);
        return null;
    }
    const { workspaceId } = match;
    const receivedAt = Number(event.timestamp) || Date.now();
    await recordInbound(workspaceId, platform, senderId, receivedAt);

    // Photos, stickers and story replies without text open the window but need no automatic answer.
    const original = String(event.message?.text || '').trim();
    if (!original) return workspaceId;
    const text = original.toLowerCase();

    if (OPT_OUT_WORDS.includes(text)) {
        await optOut(workspaceId, platform, senderId);
        return workspaceId;
    }
    if (await isOptedOut(workspaceId, platform, senderId)) return workspaceId;

    // The owner is answering this person by hand: no automatic replies, no AI draft.
    if ((await handoverUntil(workspaceId, platform, senderId)) > Date.now()) return workspaceId;

    const plan = await workspacePlan(workspaceId);
    const profile = await senderProfile(workspaceId, platform, senderId);
    if (automationsEnabled(plan)) {
        const ctx: RunContext = { workspaceId, platform, senderId, original, profile, eventKey, leads: hasLeads(plan) };
        const outcome = await runRules(ctx);
        if (outcome === 'replied') return workspaceId;
        if (outcome === 'none' && (await runInboxAutoReply(ctx)) === 'replied') return workspaceId;
    }

    // The approval queue (and its AI draft, which costs a model call) is only on plans that can see it.
    if (!hasQueue(plan)) return workspaceId;
    const queued = workspaceRef(workspaceId).collection('dmQueue').doc(`evt_${eventKey}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 200));
    if ((await queued.get()).exists) return workspaceId; // added by an earlier attempt of this event
    try {
        await queued.create({
            senderId,
            senderName: profile.name || profile.username || `${platform === 'instagram' ? 'Instagram' : 'Facebook'} user ${senderId.slice(-4)}`,
            senderAvatar: profile.avatar,
            originalMessage: original,
            aiSuggestedReply: await suggestReply(original, platform),
            platform,
            status: 'pending',
            windowEndsAt: receivedAt + REPLY_WINDOW_MS,
            receivedAt: FieldValue.serverTimestamp(),
        });
    } catch (error: any) {
        if (error.code !== 6) throw error; // 6 = ALREADY_EXISTS
    }
    return workspaceId;
}

/** A message the account sent: ours (ignored) or typed by the owner (pauses automation in the thread). */
async function handleEcho(platform: MetaChannel, accountId: string, event: any): Promise<string | null> {
    const recipientId = String(event.recipient?.id || '');
    if (!recipientId || recipientId === accountId) return null;
    const [match] = await findConnections('accountId', accountId, [platform]);
    if (!match) return null;
    const { workspaceId } = match;
    const mid = String(event.message?.mid || '');
    const at = Number(event.timestamp) || Date.now();
    const lastOut = (await threadRef(workspaceId, platform, recipientId).get()).data()?.lastOut || null;
    const own = isOwnEcho(
        { appId: event.message?.app_id ?? null, text: event.message?.text, at },
        { ourAppId: process.env.FACEBOOK_APP_ID || '', midKnown: Boolean(mid && lastOut?.mid === mid) || (await isOwnMessage(mid)), lastOut }
    );
    if (!own) {
        await startHandover(workspaceId, platform, recipientId, at);
        console.log(`[Messaging] Owner replied by hand on ${platform}: automation paused in that conversation`);
    }
    return workspaceId;
}

type Outcome = 'replied' | 'cooldown' | 'none';

interface RunContext {
    workspaceId: string;
    platform: MetaChannel;
    senderId: string;
    original: string;
    profile: { name: string; username: string };
    eventKey: string;
    leads: boolean;
}

/**
 * Sends one automated DM under a claim. Returns 'replied' when the message went out (now or in an
 * earlier attempt). A temporary failure is rethrown (the event retries); a permanent one frees the
 * claim and is recorded on the rule.
 */
async function sendUnderClaim(ctx: RunContext, claim: RunClaim, template: string) {
    if (!claim.steps.dm) {
        try {
            await sendDM(ctx.workspaceId, ctx.platform, ctx.senderId, fillPlaceholders(template, ctx.profile), { automated: true });
        } catch (error) {
            // The identical text already reached this person minutes ago (an earlier attempt): it counts as sent.
            if (!(error instanceof DmError && error.code === 'duplicate')) throw error;
        }
        await markStep(claim, 'dm');
    }
    await completeRun(claim);
}

/** DM keyword rules from the Automations page: at most one automatic reply per message. */
async function runRules(ctx: RunContext): Promise<Outcome> {
    let outcome: Outcome = 'none';
    let retryError: unknown = null;
    for (const rule of await matchingRules(ctx.workspaceId, 'dm_keyword', ctx.platform, ctx.original)) {
        const type = rule.action?.type;
        const sends = type === 'send_dm' && !!rule.action.config?.message;
        if (sends && outcome !== 'none') continue;
        if (!sends && type !== 'add_lead') continue;
        if (type === 'add_lead' && !ctx.leads) {
            await recordRuleFailure(rule.ref, 'Not run: adding people to Leads is part of the Agency plan.');
            continue;
        }
        let claim: RunClaim | null = null;
        try {
            claim = await claimRun(ctx.workspaceId, rule.id, ctx.platform, ctx.senderId, ctx.eventKey);
            if (claim.decision !== 'run') {
                if (sends) outcome = claim.decision === 'done' ? 'replied' : 'cooldown';
                continue;
            }
            if (sends) {
                await sendUnderClaim(ctx, claim, rule.action.config.message!);
                outcome = 'replied';
            } else {
                await addLead(ctx.workspaceId, ctx.platform, { id: ctx.senderId, ...ctx.profile }, `Automation: ${rule.name || rule.id}`);
                await completeRun(claim);
            }
            await countRun(rule);
        } catch (error) {
            console.error(`[Automation] "${rule.name || rule.id}" failed:`, (error as Error).message);
            await recordRuleFailure(rule.ref, error);
            if (isRetryable(error)) {
                retryError ??= error;
                if (sends) outcome = 'cooldown'; // no other automatic reply while this one is retried
            } else if (claim) {
                await releaseRun(claim);
            }
        }
    }
    if (retryError) throw retryError;
    return outcome;
}

/** Inbox keyword auto-replies (workspaces/{id}/dmAutomations). Rules made before Messenger support are Instagram's. */
async function runInboxAutoReply(ctx: RunContext): Promise<Outcome> {
    const snap = await workspaceRef(ctx.workspaceId).collection('dmAutomations').where('isActive', '==', true).get();
    for (const doc of snap.docs) {
        const auto = doc.data();
        if ((auto.platform || 'instagram') !== ctx.platform) continue;
        if (!auto.keyword || !auto.replyTemplate || !keywordMatches(ctx.original, String(auto.keyword))) continue;
        let claim: RunClaim | null = null;
        try {
            claim = await claimRun(ctx.workspaceId, `inbox_${doc.id}`, ctx.platform, ctx.senderId, ctx.eventKey);
            if (claim.decision !== 'run') return claim.decision === 'done' ? 'replied' : 'cooldown';
            await sendUnderClaim(ctx, claim, auto.replyTemplate);
            await doc.ref.update({ sentCount: FieldValue.increment(1), lastRunAt: Date.now(), lastError: null });
            return 'replied';
        } catch (error) {
            console.error('[Inbox] Auto-reply failed:', (error as Error).message);
            await recordRuleFailure(doc.ref, error);
            if (isRetryable(error)) throw error;
            if (claim) await releaseRun(claim);
        }
    }
    return 'none';
}
