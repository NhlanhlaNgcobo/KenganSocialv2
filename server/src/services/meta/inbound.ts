import admin from 'firebase-admin';
import { findConnections } from '../connection-lookup';
import {
    OPT_OUT_WORDS,
    REPLY_WINDOW_MS,
    fillPlaceholders,
    isOptedOut,
    optOut,
    recordInbound,
    sendDM,
    senderProfile,
    workspaceRef,
    type MetaChannel,
} from './messaging';
import { addLead, countRun, matchingRules, suggestReply } from './rules';

/**
 * One incoming Instagram DM or Facebook Messenger message (webhook events instagram.message and
 * page.message, via services/webhooks). entry.id is the Instagram professional account id or the
 * Page id, which is the connection's accountId.
 *
 * Order: record the message (opens the 24-hour reply window), honour opt-outs, run the Automations
 * page rules, then Inbox auto-replies; otherwise queue an AI-suggested reply for the owner to approve.
 * Returns the workspace it belonged to, or null if no workspace has this account.
 */
export async function handleMetaMessage(platform: MetaChannel, accountId: string, event: any): Promise<string | null> {
    const senderId = String(event.sender?.id || '');
    if (!senderId || event.message?.is_echo || senderId === accountId) return null;

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

    const profile = await senderProfile(workspaceId, platform, senderId);
    if (await runRules(workspaceId, platform, senderId, original, profile)) return workspaceId;
    if (await runInboxAutoReply(workspaceId, platform, senderId, text, profile)) return workspaceId;

    await workspaceRef(workspaceId).collection('dmQueue').add({
        senderId,
        senderName: profile.name || profile.username || `${platform === 'instagram' ? 'Instagram' : 'Facebook'} user ${senderId.slice(-4)}`,
        senderAvatar: profile.avatar,
        originalMessage: original,
        aiSuggestedReply: await suggestReply(original, platform),
        platform,
        status: 'pending',
        windowEndsAt: receivedAt + REPLY_WINDOW_MS,
        receivedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return workspaceId;
}

/** DM keyword rules from the Automations page. Returns true if one replied. */
async function runRules(workspaceId: string, platform: MetaChannel, senderId: string, original: string, profile: { name: string; username: string }) {
    let replied = false;
    for (const rule of await matchingRules(workspaceId, 'dm_keyword', platform, original)) {
        try {
            if (rule.action?.type === 'send_dm' && rule.action.config?.message) {
                if (replied) continue; // one automatic reply per message
                await sendDM(workspaceId, platform, senderId, fillPlaceholders(rule.action.config.message, profile));
                replied = true;
            } else if (rule.action?.type === 'add_lead') {
                await addLead(workspaceId, platform, { id: senderId, ...profile }, `Automation: ${rule.name || rule.id}`);
            } else {
                continue;
            }
            await countRun(rule);
        } catch (error) {
            console.error(`[Automation] "${rule.name || rule.id}" failed:`, (error as Error).message);
        }
    }
    return replied;
}

/** Inbox keyword auto-replies (workspaces/{id}/dmAutomations). Rules made before Messenger support are Instagram's. */
async function runInboxAutoReply(workspaceId: string, platform: MetaChannel, senderId: string, text: string, profile: { name: string; username: string }) {
    const snap = await workspaceRef(workspaceId).collection('dmAutomations').where('isActive', '==', true).get();
    for (const doc of snap.docs) {
        const auto = doc.data();
        if ((auto.platform || 'instagram') !== platform) continue;
        if (!auto.keyword || !auto.replyTemplate || !text.includes(String(auto.keyword).toLowerCase())) continue;
        try {
            await sendDM(workspaceId, platform, senderId, fillPlaceholders(auto.replyTemplate, profile));
            await doc.ref.update({ sentCount: admin.firestore.FieldValue.increment(1) });
            return true;
        } catch (error) {
            console.error('[Inbox] Auto-reply failed:', (error as Error).message);
        }
    }
    return false;
}
