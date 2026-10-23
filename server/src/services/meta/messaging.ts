import axios from 'axios';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../../utils/firestore';
import { redis } from '../../utils/redis';
import { decrypt } from '../../utils/tokenEncryption';
import { graphUrl } from '../../config/meta';
import { classifyGraphError } from './graph-errors';
import { RECIPIENT_DEDUPE_MS, checkSend, releaseDedupe, rememberOwnMessage, textHash } from './send-guard';

/**
 * Sending Instagram and Facebook Messenger messages for a workspace, within Meta's messaging rules:
 *  - a normal reply is allowed only within 24 hours of the person's last message to the account
 *    (the "standard messaging window"); each incoming message is recorded in dmThreads to check it;
 *  - a private reply to a comment (comment-to-DM) is allowed once per comment, within 7 days of it;
 *  - nothing is sent to someone who has opted out (dmOptOuts);
 *  - send limits (send-guard.ts): per-person burst lock and dedupe, and an hourly ceiling that pauses
 *    automated sends only (a person replying by hand is never paused).
 * Both platforms send through the linked Facebook Page: POST /{page-id}/messages with the Page token.
 * A revoked or invalid token (Graph code 190) marks the connection expired so Connections asks for a reconnect.
 */

export type MetaChannel = 'instagram' | 'facebook';
export const META_CHANNELS: MetaChannel[] = ['instagram', 'facebook'];
export const isMetaChannel = (p: unknown): p is MetaChannel => p === 'instagram' || p === 'facebook';

export const REPLY_WINDOW_MS = 24 * 3600 * 1000;
export const PRIVATE_REPLY_WINDOW_MS = 7 * 86400 * 1000;
export const OPT_OUT_WORDS = ['stop', 'unsubscribe', 'remove me', 'opt out'];

const CHANNEL_NAME: Record<MetaChannel, string> = { instagram: 'Instagram', facebook: 'Messenger' };

/** Why a send was refused, so automations can decide what to do (retry, skip, record). */
export type DmErrorCode =
    | 'window'
    | 'opted_out'
    | 'not_connected'
    | 'token'
    | 'duplicate'
    | 'burst'
    | 'paused'
    | 'refused'
    | 'unreachable'
    | 'invalid'
    | 'already_sent';

export class DmError extends Error {
    status: number;
    code: DmErrorCode;
    /** Worth retrying later (network errors, rate limits): webhook handlers rethrow these so the dispatcher retries. */
    retryable: boolean;
    constructor(message: string, status = 400, code: DmErrorCode = 'invalid', retryable = false) {
        super(message);
        this.status = status;
        this.code = code;
        this.retryable = retryable;
    }
}

/** Automated sends (rules, auto-replies) count toward the hourly ceiling; manual ones never do. */
export interface SendOptions {
    automated?: boolean;
}

export const workspaceRef = (workspaceId: string) => db.collection('workspaces').doc(workspaceId);

/** The Page id, account id and Page token used to message for this workspace's account on a channel. */
export async function getMessaging(workspaceId: string, platform: MetaChannel) {
    const snap = await workspaceRef(workspaceId).collection('connections').doc(platform).get();
    const conn = snap.data();
    if (!snap.exists || !conn) throw new DmError(`Connect ${platform === 'instagram' ? 'Instagram' : 'your Facebook Page'} first (Connections page).`, 409, 'not_connected');
    if (conn.status !== 'active') throw new DmError(`Reconnect ${platform === 'instagram' ? 'Instagram' : 'Facebook'}: access has expired.`, 409, 'token');
    if (platform === 'instagram') {
        if (!conn.pageId || !conn.pageAccessToken) {
            throw new DmError('Reconnect Instagram to allow messaging: the connection was made before messaging was enabled.', 409, 'not_connected');
        }
        return { pageId: String(conn.pageId), accountId: String(conn.accountId || ''), token: decrypt(conn.pageAccessToken) };
    }
    // Facebook: the connection is the Page itself and accessToken is its Page token.
    return { pageId: String(conn.accountId), accountId: String(conn.accountId), token: decrypt(conn.accessToken) };
}

/**
 * Meta refused the token (revoked, password changed, app removed): mark the connection expired so
 * the Connections page shows "Reconnect" and automations stop trying. The usual expired-connection
 * clean-up (routes/connections.ts) then applies.
 */
export async function markNeedsReconnect(workspaceId: string, platform: MetaChannel, info: { code: number | null; subcode: number | null; message: string }) {
    const ref = workspaceRef(workspaceId).collection('connections').doc(platform);
    try {
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists) return;
            const data = snap.data() || {};
            tx.update(ref, {
                status: 'expired',
                ...(data.status === 'expired' && data.expiredAt ? {} : { expiredAt: Date.now() }),
                tokenError: { code: info.code, subcode: info.subcode, message: String(info.message).slice(0, 300), at: Date.now() },
                updatedAt: FieldValue.serverTimestamp(),
            });
        });
        console.warn(`[Messaging] ${platform} token for workspace ${workspaceId} was refused (code ${info.code}/${info.subcode}): marked for reconnect`);
    } catch (error) {
        console.error('[Messaging] Could not mark the connection for reconnect:', (error as Error).message);
    }
}

export const threadRef = (workspaceId: string, platform: MetaChannel, senderId: string) =>
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

// ─── Human handover ──────────────────────────────────────────────────────────────────────────────

/** How long automation stays paused in a conversation after the owner replies by hand. */
export const HANDOVER_MS = 12 * 3600 * 1000;
/** An echo carrying the text we sent this person within this long is ours (its id may not be known yet). */
const OWN_ECHO_MATCH_MS = 5 * 60 * 1000;

/** Until when the owner has taken over this conversation (0 = automation runs). */
export async function handoverUntil(workspaceId: string, platform: MetaChannel, senderId: string) {
    const snap = await threadRef(workspaceId, platform, senderId).get();
    return Number(snap.data()?.handoverUntil || 0);
}

/**
 * An echo is a message the account sent. It is ours if Meta reports our app id, its message id is one
 * we sent, or it carries the text we sent this person in the last few minutes (the echo can arrive
 * before our send call returns). Anything else was typed by the owner in Instagram, Messenger or
 * Business Suite.
 */
export function isOwnEcho(
    echo: { appId?: string | number | null; text?: string; at: number },
    known: { ourAppId: string; midKnown: boolean | null; lastOut?: { hash?: string; at?: number } | null }
) {
    if (echo.appId && known.ourAppId && String(echo.appId) === String(known.ourAppId)) return true;
    if (known.midKnown) return true;
    const last = known.lastOut;
    return !!(last?.hash && echo.text && last.hash === textHash(echo.text) && Math.abs(echo.at - Number(last.at || 0)) < OWN_ECHO_MATCH_MS);
}

/** The owner replied by hand: automation pauses in this conversation for HANDOVER_MS. */
export async function startHandover(workspaceId: string, platform: MetaChannel, recipientId: string, at = Date.now()) {
    await threadRef(workspaceId, platform, recipientId).set(
        { platform, senderId: recipientId, handoverUntil: at + HANDOVER_MS, lastManualAt: at, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
    );
}

async function recordOutbound(workspaceId: string, platform: MetaChannel, recipientId: string, text: string, mid?: string) {
    await threadRef(workspaceId, platform, recipientId)
        .set({ platform, senderId: recipientId, lastOut: { hash: textHash(text), at: Date.now(), ...(mid ? { mid } : {}) } }, { merge: true })
        .catch((error) => console.warn('[Messaging] Could not record the sent message:', error.message));
}

// ─── Opt-outs ────────────────────────────────────────────────────────────────────────────────────

export async function isOptedOut(workspaceId: string, platform: MetaChannel, senderId: string) {
    const optOuts = workspaceRef(workspaceId).collection('dmOptOuts');
    // Older opt-outs were stored by sender id alone (Instagram only).
    const [scoped, legacy] = await Promise.all([optOuts.doc(`${platform}_${senderId}`).get(), optOuts.doc(senderId).get()]);
    return scoped.exists || legacy.exists;
}

export async function optOut(workspaceId: string, platform: MetaChannel, senderId: string) {
    await workspaceRef(workspaceId).collection('dmOptOuts').doc(`${platform}_${senderId}`).set({ platform, senderId, addedAt: FieldValue.serverTimestamp() });
}

// ─── Sending ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Send limits (send-guard.ts). Refusals are DmErrors: a burst is retryable (a few seconds later is
 * fine), a duplicate or a paused channel is not. The first time the hourly ceiling is reached it is
 * recorded on the workspace (automationPause.<channel>) so the Automations page can show it.
 */
async function guard(workspaceId: string, platform: MetaChannel, target: string, recipient: string, text: string, opts: SendOptions) {
    const result = await checkSend({ workspaceId, channel: platform, target, recipient, text, automated: !!opts.automated });
    if (result.ok) return;
    if (result.refusal === 'burst') throw new DmError('Slow down: one message every 2 seconds to the same person.', 429, 'burst', true);
    if (result.refusal === 'duplicate') {
        throw new DmError(`This exact message was already sent to this person in the last ${Math.round(RECIPIENT_DEDUPE_MS / 60000)} minutes.`, 409, 'duplicate');
    }
    if (result.pauseStarted) {
        await workspaceRef(workspaceId)
            .set({ automationPause: { [platform]: { until: result.pausedUntil, at: Date.now(), reason: 'hourly_limit' } } }, { merge: true })
            .catch((error) => console.warn('[Messaging] Could not record the automation pause:', error.message));
        console.warn(`[Messaging] Automated ${platform} sends paused for workspace ${workspaceId} until ${new Date(result.pausedUntil || 0).toISOString()} (hourly limit)`);
    }
    throw new DmError(
        `Automatic ${CHANNEL_NAME[platform]} replies are paused until ${new Date(result.pausedUntil || Date.now()).toISOString().slice(11, 16)} UTC: the hourly limit was reached. You can still reply by hand.`,
        429,
        'paused'
    );
}

function cleanText(text: string) {
    const message = String(text || '').trim();
    if (!message) throw new DmError('The message is empty.');
    return message.slice(0, 1000);
}

/** Turns a Graph error from a send into a DmError, marking the connection for reconnect on a refused token. */
async function sendFailure(workspaceId: string, platform: MetaChannel, error: any, what: string): Promise<DmError> {
    const info = classifyGraphError(error);
    const name = CHANNEL_NAME[platform];
    if (info.kind === 'token') {
        await markNeedsReconnect(workspaceId, platform, info);
        return new DmError(`Reconnect ${platform === 'instagram' ? 'Instagram' : 'Facebook'} on the Connections page: Meta no longer accepts its access (${info.message}).`, 409, 'token');
    }
    if (info.kind === 'window') {
        return new DmError(`${name} only allows a reply within 24 hours of the person's last message. They need to message you again first.`, 409, 'window');
    }
    if (info.kind === 'retryable') {
        return new DmError(error?.response ? `${name} is busy (${info.message}). Try again shortly.` : `${name} could not be reached. Try again.`, 502, 'unreachable', true);
    }
    return new DmError(`${name} refused the ${what}: ${info.message}`, 502, 'refused');
}

async function postMessage(workspaceId: string, platform: MetaChannel, pageId: string, token: string, body: Record<string, unknown>) {
    try {
        const { data } = await axios.post(graphUrl(`${pageId}/messages`), body, { params: { access_token: token }, timeout: 15000 });
        const mid = String(data?.message_id || '');
        await rememberOwnMessage(mid);
        return mid;
    } catch (error: any) {
        throw await sendFailure(workspaceId, platform, error, 'message');
    }
}

/** A reply in a conversation the person started, refused once the 24-hour window has closed. */
export async function sendDM(workspaceId: string, platform: MetaChannel, recipientId: string, text: string, opts: SendOptions = {}) {
    const message = cleanText(text);
    if (!recipientId) throw new DmError('This message has no recipient to reply to.');
    if (await isOptedOut(workspaceId, platform, recipientId)) throw new DmError('This person opted out of messages.', 409, 'opted_out');
    const endsAt = await replyWindowEndsAt(workspaceId, platform, recipientId);
    if (!endsAt || endsAt < Date.now()) {
        throw new DmError(
            `The 24-hour reply window has closed. ${CHANNEL_NAME[platform]} only allows replies within 24 hours of the person's last message, so they need to message you again first.`,
            409,
            'window'
        );
    }
    const { pageId, token } = await getMessaging(workspaceId, platform);
    await guard(workspaceId, platform, `dm:${platform}:${recipientId}`, recipientId, message, opts);
    const body: Record<string, unknown> = { recipient: { id: recipientId }, message: { text: message } };
    if (platform === 'facebook') body.messaging_type = 'RESPONSE';
    // Recorded before sending: the echo of this message can arrive before the send call returns.
    await recordOutbound(workspaceId, platform, recipientId, message);
    let id: string;
    try {
        id = await postMessage(workspaceId, platform, pageId, token, body);
    } catch (error) {
        await releaseDedupe(workspaceId, platform, recipientId, message);
        throw error;
    }
    if (id) await recordOutbound(workspaceId, platform, recipientId, message, id);
    redis.incr(`dm:sent:${workspaceId}:${new Date().toISOString().slice(0, 10)}`).catch(() => {});
    return id;
}

/**
 * A private reply to a comment (comment-to-DM). Meta allows one per comment, within 7 days of it;
 * the caller records that it was sent so it is never sent twice.
 */
export async function sendPrivateReply(
    workspaceId: string,
    platform: MetaChannel,
    comment: { commentId: string; fromId: string; createdAt: number },
    text: string,
    opts: SendOptions = {}
) {
    const message = cleanText(text);
    if (comment.createdAt && comment.createdAt < Date.now() - PRIVATE_REPLY_WINDOW_MS) {
        throw new DmError('Private replies are only allowed within 7 days of the comment.', 409, 'window');
    }
    if (comment.fromId && (await isOptedOut(workspaceId, platform, comment.fromId))) throw new DmError('This person opted out of messages.', 409, 'opted_out');
    const { pageId, token } = await getMessaging(workspaceId, platform);
    const recipient = comment.fromId || `comment:${comment.commentId}`;
    await guard(workspaceId, platform, `private:${comment.commentId}`, recipient, message, opts);
    if (comment.fromId) await recordOutbound(workspaceId, platform, comment.fromId, message);
    try {
        const id = await postMessage(workspaceId, platform, pageId, token, { recipient: { comment_id: comment.commentId }, message: { text: message } });
        if (id && comment.fromId) await recordOutbound(workspaceId, platform, comment.fromId, message, id);
        return id;
    } catch (error) {
        await releaseDedupe(workspaceId, platform, recipient, message);
        throw error;
    }
}

/** A public reply under a comment: Instagram POST /{comment-id}/replies, Facebook POST /{comment-id}/comments. */
export async function replyToComment(workspaceId: string, platform: MetaChannel, commentId: string, text: string, opts: SendOptions = {}) {
    const message = cleanText(text);
    const { token } = await getMessaging(workspaceId, platform);
    // Deduped per comment: the same public reply under two different comments is expected.
    const recipient = `comment:${commentId}`;
    await guard(workspaceId, platform, `public:${commentId}`, recipient, message, opts);
    try {
        const { data } = await axios.post(graphUrl(`${commentId}/${platform === 'instagram' ? 'replies' : 'comments'}`), null, {
            params: { message, access_token: token },
            timeout: 15000,
        });
        return String(data?.id || '');
    } catch (error: any) {
        await releaseDedupe(workspaceId, platform, recipient, message);
        throw await sendFailure(workspaceId, platform, error, 'reply');
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
