import crypto from 'crypto';
import axios from 'axios';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../../utils/firestore';
import { redis } from '../../utils/redis';
import { decrypt } from '../../utils/tokenEncryption';
import { graphUrl, graphErrorMessage } from '../../config/meta';

/**
 * Sending Instagram and Facebook Messenger messages for a workspace, within Meta's messaging rules:
 *  - a normal reply is allowed only within 24 hours of the person's last message to the account
 *    (the "standard messaging window"); each incoming message is recorded in dmThreads to check it;
 *  - a private reply to a comment (comment-to-DM) is allowed once per comment, within 7 days of it;
 *  - nothing is sent to someone who has opted out (dmOptOuts).
 * Both platforms send through the linked Facebook Page: POST /{page-id}/messages with the Page token.
 */

export type MetaChannel = 'instagram' | 'facebook';
export const META_CHANNELS: MetaChannel[] = ['instagram', 'facebook'];
export const isMetaChannel = (p: unknown): p is MetaChannel => p === 'instagram' || p === 'facebook';

export const REPLY_WINDOW_MS = 24 * 3600 * 1000;
export const PRIVATE_REPLY_WINDOW_MS = 7 * 86400 * 1000;
export const OPT_OUT_WORDS = ['stop', 'unsubscribe', 'remove me', 'opt out'];

const CHANNEL_NAME: Record<MetaChannel, string> = { instagram: 'Instagram', facebook: 'Messenger' };

export class DmError extends Error {
    status: number;
    constructor(message: string, status = 400) {
        super(message);
        this.status = status;
    }
}

export const workspaceRef = (workspaceId: string) => db.collection('workspaces').doc(workspaceId);

/** The Page id, account id and Page token used to message for this workspace's account on a channel. */
export async function getMessaging(workspaceId: string, platform: MetaChannel) {
    const snap = await workspaceRef(workspaceId).collection('connections').doc(platform).get();
    const conn = snap.data();
    if (!snap.exists || !conn) throw new DmError(`Connect ${platform === 'instagram' ? 'Instagram' : 'your Facebook Page'} first (Connections page).`, 409);
    if (conn.status !== 'active') throw new DmError(`Reconnect ${platform === 'instagram' ? 'Instagram' : 'Facebook'}: access has expired.`, 409);
    if (platform === 'instagram') {
        if (!conn.pageId || !conn.pageAccessToken) {
            throw new DmError('Reconnect Instagram to allow messaging: the connection was made before messaging was enabled.', 409);
        }
        return { pageId: String(conn.pageId), accountId: String(conn.accountId || ''), token: decrypt(conn.pageAccessToken) };
    }
    // Facebook: the connection is the Page itself and accessToken is its Page token.
    return { pageId: String(conn.accountId), accountId: String(conn.accountId), token: decrypt(conn.accessToken) };
}

const threadRef = (workspaceId: string, platform: MetaChannel, senderId: string) =>
    workspaceRef(workspaceId).collection('dmThreads').doc(`${platform}_${senderId}`);

/** Records a message from a person, which opens (or extends) the 24-hour reply window. */
export async function recordInbound(workspaceId: string, platform: MetaChannel, senderId: string, at = Date.now()) {
    await threadRef(workspaceId, platform, senderId).set({ platform, senderId, lastInboundAt: at, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

/** When the reply window to this person closes (0 if they never messaged). */
export async function replyWindowEndsAt(workspaceId: string, platform: MetaChannel, senderId: string) {
    const snap = await threadRef(workspaceId, platform, senderId).get();
    const last = Number(snap.data()?.lastInboundAt || 0);
    return last ? last + REPLY_WINDOW_MS : 0;
}

export async function isOptedOut(workspaceId: string, platform: MetaChannel, senderId: string) {
    const optOuts = workspaceRef(workspaceId).collection('dmOptOuts');
    // Older opt-outs were stored by sender id alone (Instagram only).
    const [scoped, legacy] = await Promise.all([optOuts.doc(`${platform}_${senderId}`).get(), optOuts.doc(senderId).get()]);
    return scoped.exists || legacy.exists;
}

export async function optOut(workspaceId: string, platform: MetaChannel, senderId: string) {
    await workspaceRef(workspaceId).collection('dmOptOuts').doc(`${platform}_${senderId}`).set({ platform, senderId, addedAt: FieldValue.serverTimestamp() });
}

/**
 * Rate limit and spam guard: at most one message every 2 seconds to the same person (or comment),
 * and sending pauses for 24 hours after the same text goes out more than 10 times in an hour.
 * Fails open (with a warning) when Redis is unavailable.
 */
async function throttle(workspaceId: string, text: string, target: string) {
    try {
        if (await redis.get(`dm:locked:${workspaceId}`)) throw new DmError('Message sending is paused for 24 hours after repeated identical messages.', 429);
        const ok = await redis.set(`dm:lock:${workspaceId}:${target}`, '1', 'PX', 2000, 'NX');
        if (!ok) throw new DmError('Slow down: one message every 2 seconds to the same person.', 429);
        const abuseKey = `dm:abuse:${workspaceId}:${crypto.createHash('sha256').update(text).digest('hex')}`;
        const identical = await redis.incr(abuseKey);
        if (identical === 1) await redis.expire(abuseKey, 3600);
        if (identical > 10) {
            await redis.set(`dm:locked:${workspaceId}`, '1', 'EX', 86400);
            throw new DmError('Spam protection: the same message was sent more than 10 times in an hour. Messages are paused for 24 hours.', 429);
        }
    } catch (error) {
        if (error instanceof DmError) throw error;
        console.warn('[Messaging] Rate limiter unavailable (Redis), sending without it:', (error as Error).message);
    }
}

function cleanText(text: string) {
    const message = String(text || '').trim();
    if (!message) throw new DmError('The message is empty.');
    return message.slice(0, 1000);
}

async function postMessage(platform: MetaChannel, pageId: string, token: string, body: Record<string, unknown>) {
    try {
        const { data } = await axios.post(graphUrl(`${pageId}/messages`), body, { params: { access_token: token }, timeout: 15000 });
        return String(data?.message_id || '');
    } catch (error: any) {
        const meta = error.response?.data?.error;
        // Subcode 2018278: sent outside the allowed messaging window.
        if (meta?.error_subcode === 2018278) {
            throw new DmError(`${CHANNEL_NAME[platform]} only allows a reply within 24 hours of the person's last message. They need to message you again first.`, 409);
        }
        throw new DmError(meta?.message ? `${CHANNEL_NAME[platform]} refused the message: ${meta.message}` : `${CHANNEL_NAME[platform]} could not be reached. Try again.`, 502);
    }
}

/** A reply in a conversation the person started, refused once the 24-hour window has closed. */
export async function sendDM(workspaceId: string, platform: MetaChannel, recipientId: string, text: string) {
    const message = cleanText(text);
    if (!recipientId) throw new DmError('This message has no recipient to reply to.');
    if (await isOptedOut(workspaceId, platform, recipientId)) throw new DmError('This person opted out of messages.', 409);
    const endsAt = await replyWindowEndsAt(workspaceId, platform, recipientId);
    if (!endsAt || endsAt < Date.now()) {
        throw new DmError(`The 24-hour reply window has closed. ${CHANNEL_NAME[platform]} only allows replies within 24 hours of the person's last message, so they need to message you again first.`, 409);
    }
    const { pageId, token } = await getMessaging(workspaceId, platform);
    await throttle(workspaceId, message, `dm:${platform}:${recipientId}`);
    const body: Record<string, unknown> = { recipient: { id: recipientId }, message: { text: message } };
    if (platform === 'facebook') body.messaging_type = 'RESPONSE';
    const id = await postMessage(platform, pageId, token, body);
    redis.incr(`dm:sent:${workspaceId}:${new Date().toISOString().slice(0, 10)}`).catch(() => {});
    return id;
}

/**
 * A private reply to a comment (comment-to-DM). Meta allows one per comment, within 7 days of it;
 * the caller records that it was sent so it is never sent twice.
 */
export async function sendPrivateReply(workspaceId: string, platform: MetaChannel, comment: { commentId: string; fromId: string; createdAt: number }, text: string) {
    const message = cleanText(text);
    if (comment.createdAt && comment.createdAt < Date.now() - PRIVATE_REPLY_WINDOW_MS) {
        throw new DmError('Private replies are only allowed within 7 days of the comment.', 409);
    }
    if (comment.fromId && (await isOptedOut(workspaceId, platform, comment.fromId))) throw new DmError('This person opted out of messages.', 409);
    const { pageId, token } = await getMessaging(workspaceId, platform);
    await throttle(workspaceId, message, `private:${comment.commentId}`);
    return postMessage(platform, pageId, token, { recipient: { comment_id: comment.commentId }, message: { text: message } });
}

/** A public reply under a comment: Instagram POST /{comment-id}/replies, Facebook POST /{comment-id}/comments. */
export async function replyToComment(workspaceId: string, platform: MetaChannel, commentId: string, text: string) {
    const message = cleanText(text);
    const { token } = await getMessaging(workspaceId, platform);
    await throttle(workspaceId, message, `public:${commentId}`);
    try {
        const { data } = await axios.post(graphUrl(`${commentId}/${platform === 'instagram' ? 'replies' : 'comments'}`), null, {
            params: { message, access_token: token },
            timeout: 15000,
        });
        return String(data?.id || '');
    } catch (error: any) {
        throw new DmError(`${platform === 'instagram' ? 'Instagram' : 'Facebook'} refused the reply: ${graphErrorMessage(error)}`, 502);
    }
}

/** Name, username and picture of the person messaging the account (blank when Meta doesn't share them). */
export async function senderProfile(workspaceId: string, platform: MetaChannel, senderId: string) {
    try {
        const { token } = await getMessaging(workspaceId, platform);
        const fields = platform === 'instagram' ? 'name,username,profile_pic' : 'first_name,last_name,profile_pic';
        const { data } = await axios.get(graphUrl(senderId), { params: { fields, access_token: token }, timeout: 8000 });
        const name = platform === 'instagram' ? data.name || data.username || '' : [data.first_name, data.last_name].filter(Boolean).join(' ');
        return { name, username: data.username || '', avatar: data.profile_pic || '' };
    } catch {
        return { name: '', username: '', avatar: '' };
    }
}

/** Replaces {name} / {username} in a reply template with the person's details ("there" when unknown). */
export function fillPlaceholders(template: string, profile: { name: string; username: string }) {
    const name = (profile.name || profile.username || '').trim() || 'there';
    const username = (profile.username || '').trim() || 'there';
    return String(template || '')
        .replace(/\{\s*name\s*\}/gi, () => name)
        .replace(/\{\s*username\s*\}/gi, () => username);
}
