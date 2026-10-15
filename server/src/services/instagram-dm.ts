import crypto from 'crypto';
import axios from 'axios';
import admin from 'firebase-admin';
import { db } from '../utils/firestore';
import { redis } from '../utils/redis';
import { decrypt } from '../utils/tokenEncryption';
import { CHAT_MODEL, chatClient } from './llm-client.js';
import { processLeadScore } from './leads/scoreService';

/**
 * Instagram DMs through the Messenger API for Instagram.
 *
 * The Instagram connection (routes/connections.ts) stores the linked Facebook Page's id and an
 * encrypted Page access token; messages are sent as POST /{page-id}/messages with that token.
 * Incoming messages arrive on a Meta webhook (object "instagram"), where entry.id is the
 * Instagram professional account id, which is the connection's accountId.
 *
 * One handler serves both the Inbox (dmAutomations + dmQueue) and the Automations page
 * (automations collection), so a single Meta webhook URL drives both.
 */

const GRAPH = 'https://graph.facebook.com/v19.0';
const OPT_OUT_WORDS = ['stop', 'unsubscribe', 'remove me', 'opt out'];

export class DmError extends Error {
    status: number;
    constructor(message: string, status = 400) {
        super(message);
        this.status = status;
    }
}

const workspaceRef = (workspaceId: string) => db.collection('workspaces').doc(workspaceId);

/** The Page id and Page token needed to send messages for this workspace's Instagram account. */
export async function getInstagramMessaging(workspaceId: string) {
    const snap = await workspaceRef(workspaceId).collection('connections').doc('instagram').get();
    const conn = snap.data();
    if (!snap.exists || !conn) throw new DmError('Connect Instagram first (Connections page).', 409);
    if (!conn.pageId || !conn.pageAccessToken) {
        throw new DmError('Reconnect Instagram to allow messaging: the connection was made before messaging was enabled.', 409);
    }
    return { pageId: String(conn.pageId), igAccountId: String(conn.accountId || ''), token: decrypt(conn.pageAccessToken) };
}

/** Rate limit and spam guard. Fails open (with a warning) when Redis is unavailable. */
async function throttle(workspaceId: string, text: string) {
    try {
        if (await redis.get(`dm:locked:${workspaceId}`)) throw new DmError('DM sending is paused for 24 hours after repeated identical messages.', 429);
        const ok = await redis.set(`dm:lock:${workspaceId}`, '1', 'PX', 2000, 'NX');
        if (!ok) throw new DmError('Slow down: one message every 2 seconds.', 429);
        const abuseKey = `dm:abuse:${workspaceId}:${crypto.createHash('sha256').update(text).digest('hex')}`;
        const identical = await redis.incr(abuseKey);
        if (identical === 1) await redis.expire(abuseKey, 3600);
        if (identical > 10) {
            await redis.set(`dm:locked:${workspaceId}`, '1', 'EX', 86400);
            throw new DmError('Spam protection: the same message was sent more than 10 times in an hour. DMs are paused for 24 hours.', 429);
        }
    } catch (error) {
        if (error instanceof DmError) throw error;
        console.warn('[Instagram DM] Rate limiter unavailable (Redis), sending without it:', (error as Error).message);
    }
}

export async function sendInstagramDM(workspaceId: string, recipientId: string, text: string) {
    const message = String(text || '').trim();
    if (!message) throw new DmError('The message is empty.');
    if (!recipientId) throw new DmError('This message has no Instagram recipient to reply to.');
    const { pageId, token } = await getInstagramMessaging(workspaceId);
    await throttle(workspaceId, message);
    try {
        await axios.post(
            `${GRAPH}/${pageId}/messages`,
            { recipient: { id: recipientId }, message: { text: message.slice(0, 1000) } },
            { params: { access_token: token }, timeout: 15000 }
        );
    } catch (error: any) {
        const meta = error.response?.data?.error;
        throw new DmError(meta?.message ? `Instagram refused the message: ${meta.message}` : 'Instagram could not be reached. Try again.', 502);
    }
    redis.incr(`dm:sent:${workspaceId}:${new Date().toISOString().slice(0, 10)}`).catch(() => {});
}

/** Finds the workspace whose Instagram connection is this account (collection-group query on accountId). */
async function findInstagramConnection(igAccountId: string) {
    const snap = await db.collectionGroup('connections').where('accountId', '==', igAccountId).limit(5).get();
    const doc = snap.docs.find((d) => d.id === 'instagram' || d.data().platform === 'instagram');
    const ws = doc?.ref.parent.parent;
    return doc && ws ? { workspaceId: ws.id, connectionId: doc.id } : null;
}

async function senderProfile(workspaceId: string, senderId: string) {
    try {
        const { token } = await getInstagramMessaging(workspaceId);
        const { data } = await axios.get(`${GRAPH}/${senderId}`, { params: { fields: 'name,username,profile_pic', access_token: token }, timeout: 8000 });
        return { name: data.name || data.username || '', username: data.username || '', avatar: data.profile_pic || '' };
    } catch {
        return { name: '', username: '', avatar: '' };
    }
}

/** Replaces {name} / {username} in a reply template with the sender's details ("there" when unknown). */
export function fillPlaceholders(template: string, profile: { name: string; username: string }) {
    const name = (profile.name || profile.username || '').trim() || 'there';
    const username = (profile.username || '').trim() || 'there';
    return String(template || '')
        .replace(/\{\s*name\s*\}/gi, () => name)
        .replace(/\{\s*username\s*\}/gi, () => username);
}

async function suggestReply(text: string) {
    try {
        const aiRes = await chatClient.chat.completions.create({
            model: CHAT_MODEL,
            messages: [
                { role: 'system', content: 'You help a creator answer their Instagram DMs. Write one short, warm, natural reply. Reply with the message only.' },
                { role: 'user', content: text },
            ],
        });
        return aiRes.choices[0]?.message?.content?.trim() || '';
    } catch (error) {
        console.warn('[Instagram DM] AI reply suggestion failed:', (error as Error).message);
        return '';
    }
}

/** Automations page rules (workspaces/{id}/automations). Returns true if a rule replied. */
async function runAutomationRules(workspaceId: string, connectionId: string, senderId: string, text: string, profile: { name: string; username: string }) {
    const snap = await workspaceRef(workspaceId).collection('automations').where('status', '==', 'active').get();
    let replied = false;
    for (const doc of snap.docs) {
        const rule = doc.data();
        if (rule.trigger?.type !== 'dm_keyword') continue;
        if (Array.isArray(rule.connections) && rule.connections.length && !rule.connections.includes(connectionId)) continue;
        const keywords: string[] = rule.trigger.config?.keywords || [];
        if (!keywords.some((k) => k && text.includes(String(k).toLowerCase()))) continue;

        try {
            if (rule.action?.type === 'send_dm' && rule.action.config?.message) {
                await sendInstagramDM(workspaceId, senderId, fillPlaceholders(rule.action.config.message, profile));
                replied = true;
            } else if (rule.action?.type === 'add_lead') {
                const existing = await workspaceRef(workspaceId).collection('leads').where('externalId', '==', senderId).limit(1).get();
                if (existing.empty) {
                    await workspaceRef(workspaceId).collection('leads').add(
                        processLeadScore({
                            externalId: senderId,
                            username: profile.username || senderId,
                            displayName: profile.name || profile.username || 'Instagram user',
                            platform: 'instagram',
                            followersCount: 0,
                            status: 'prospect',
                            tags: ['automation'],
                            source: `Automation: ${rule.name || doc.id}`,
                            signals: { totalLikes: 0, totalComments: 0, storyReply: false } as any,
                            createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        } as any)
                    );
                }
            } else {
                continue;
            }
            await doc.ref.update({ runCount: admin.firestore.FieldValue.increment(1), lastRunAt: admin.firestore.FieldValue.serverTimestamp() });
        } catch (error) {
            console.error(`[Automation] "${rule.name || doc.id}" failed:`, (error as Error).message);
        }
    }
    return replied;
}

/** Inbox keyword auto-replies (workspaces/{id}/dmAutomations). Returns true if one replied. */
async function runInboxAutoReply(workspaceId: string, senderId: string, text: string, profile: { name: string; username: string }) {
    const snap = await workspaceRef(workspaceId).collection('dmAutomations').where('isActive', '==', true).get();
    for (const doc of snap.docs) {
        const auto = doc.data();
        if (!auto.keyword || !auto.replyTemplate || !text.includes(String(auto.keyword).toLowerCase())) continue;
        try {
            await sendInstagramDM(workspaceId, senderId, fillPlaceholders(auto.replyTemplate, profile));
            await doc.ref.update({ sentCount: admin.firestore.FieldValue.increment(1) });
            return true;
        } catch (error) {
            console.error('[Inbox] Auto-reply failed:', (error as Error).message);
        }
    }
    return false;
}

async function handleMessage(igAccountId: string, event: any) {
    const senderId = String(event.sender?.id || '');
    const original = String(event.message?.text || '').trim();
    if (!senderId || !original || event.message?.is_echo || senderId === igAccountId) return;

    const match = await findInstagramConnection(igAccountId);
    if (!match) {
        console.log(`[Instagram DM] No workspace is connected to Instagram account ${igAccountId}`);
        return;
    }
    const { workspaceId, connectionId } = match;
    const text = original.toLowerCase();
    const optOuts = workspaceRef(workspaceId).collection('dmOptOuts');

    if (OPT_OUT_WORDS.includes(text)) {
        await optOuts.doc(senderId).set({ addedAt: admin.firestore.FieldValue.serverTimestamp() });
        return;
    }
    if ((await optOuts.doc(senderId).get()).exists) return;

    const profile = await senderProfile(workspaceId, senderId);
    const ruleReplied = await runAutomationRules(workspaceId, connectionId, senderId, text, profile);
    if (ruleReplied || (await runInboxAutoReply(workspaceId, senderId, text, profile))) return;

    await workspaceRef(workspaceId).collection('dmQueue').add({
        senderId,
        senderName: profile.name || profile.username || `Instagram user ${senderId.slice(-4)}`,
        senderAvatar: profile.avatar,
        originalMessage: original,
        aiSuggestedReply: await suggestReply(original),
        platform: 'instagram',
        status: 'pending',
        receivedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
}

/** Processes a Meta webhook payload. Errors are logged per message so one bad event can't block the rest. */
export async function processInstagramWebhook(body: any) {
    if (body?.object !== 'instagram') return;
    for (const entry of body.entry || []) {
        for (const event of entry.messaging || []) {
            try {
                await handleMessage(String(entry.id), event);
            } catch (error) {
                console.error('[Instagram DM] Webhook event failed:', (error as Error).message);
            }
        }
    }
}

/** Webhook verification token: META_VERIFY_TOKEN (or the older META_WEBHOOK_VERIFY_TOKEN). */
export function verifyToken() {
    return process.env.META_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN || '';
}

/** Checks X-Hub-Signature-256 against the raw body when META_APP_SECRET is set. */
export function validSignature(rawBody: string | undefined, signature: string | undefined) {
    const secret = process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET || '';
    if (!secret) return process.env.NODE_ENV !== 'production';
    if (!signature || !rawBody) return false;
    const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}
