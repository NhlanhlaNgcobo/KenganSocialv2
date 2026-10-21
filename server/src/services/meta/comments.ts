import admin from 'firebase-admin';
import { findConnections } from '../connection-lookup';
import { DmError, fillPlaceholders, replyToComment, sendPrivateReply, workspaceRef, type MetaChannel } from './messaging';
import { addLead, countRun, matchingRules } from './rules';

/**
 * Comments on Instagram media (webhook instagram.comments) and Facebook Page posts (page.feed with
 * item "comment"). Each new comment is stored once in workspaces/{id}/inboxComments for the Inbox,
 * then comment keyword rules run: a public reply, a private reply (comment-to-DM), or adding a lead.
 * The account's own comments, including the replies we post, are skipped, so rules can't loop.
 */

export interface MetaComment {
    platform: MetaChannel;
    accountId: string; // Instagram account id or Page id
    commentId: string;
    postId: string;
    parentId: string | null;
    fromId: string;
    fromName: string;
    fromUsername: string;
    text: string;
    createdAt: number;
}

const toMs = (t: unknown) => {
    const n = Number(t || 0);
    if (!n) return Date.now();
    return n < 1e12 ? n * 1000 : n;
};

export const commentDocId = (platform: MetaChannel, commentId: string) => `${platform}_${commentId}`;
const commentsCol = (workspaceId: string) => workspaceRef(workspaceId).collection('inboxComments');

/** Instagram comments webhook value → MetaComment. */
export function fromInstagram(accountId: string, value: any, time: unknown): MetaComment | null {
    if (!value?.id || !value?.from?.id) return null;
    return {
        platform: 'instagram',
        accountId,
        commentId: String(value.id),
        postId: String(value.media?.id || ''),
        parentId: value.parent_id ? String(value.parent_id) : null,
        fromId: String(value.from.id),
        fromName: String(value.from.username || ''),
        fromUsername: String(value.from.username || ''),
        text: String(value.text || ''),
        createdAt: toMs(time),
    };
}

/** Page feed webhook value (item "comment") → MetaComment. */
export function fromPageFeed(pageId: string, value: any): MetaComment | null {
    if (value?.item !== 'comment' || !value.comment_id || !value.from?.id) return null;
    return {
        platform: 'facebook',
        accountId: pageId,
        commentId: String(value.comment_id),
        postId: String(value.post_id || ''),
        parentId: value.parent_id && value.parent_id !== value.post_id ? String(value.parent_id) : null,
        fromId: String(value.from.id),
        fromName: String(value.from.name || ''),
        fromUsername: '',
        text: String(value.message || ''),
        createdAt: toMs(value.created_time),
    };
}

/** A new comment: store it, then run comment keyword rules. Returns the workspace, or null. */
export async function handleComment(comment: MetaComment): Promise<string | null> {
    if (comment.fromId === comment.accountId) return null; // the account itself, including our replies
    const [match] = await findConnections('accountId', comment.accountId, [comment.platform]);
    if (!match) {
        console.log(`[Comments] No workspace is connected to ${comment.platform} account ${comment.accountId}`);
        return null;
    }
    const { workspaceId } = match;
    const ref = commentsCol(workspaceId).doc(commentDocId(comment.platform, comment.commentId));
    try {
        await ref.create({
            ...comment,
            status: 'open',
            replies: [],
            privateReplySentAt: null,
            automation: null,
            receivedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    } catch (error: any) {
        if (error.code === 6) return workspaceId; // ALREADY_EXISTS: delivered before, rules already ran
        throw error;
    }
    if (comment.text.trim()) await runCommentRules(workspaceId, comment, ref);
    return workspaceId;
}

/** A Facebook comment was edited or removed on the platform: keep the Inbox copy in step. */
export async function syncCommentChange(platform: MetaChannel, accountId: string, commentId: string, verb: string, text?: string) {
    const [match] = await findConnections('accountId', accountId, [platform]);
    if (!match) return null;
    const ref = commentsCol(match.workspaceId).doc(commentDocId(platform, commentId));
    if (!(await ref.get()).exists) return match.workspaceId;
    if (verb === 'remove') await ref.delete();
    else if (verb === 'edited' && text !== undefined) await ref.update({ text });
    return match.workspaceId;
}

async function runCommentRules(workspaceId: string, comment: MetaComment, ref: FirebaseFirestore.DocumentReference) {
    const profile = { name: comment.fromName, username: comment.fromUsername };
    let acted = false; // one public reply and one private reply per comment, from the first matching rule
    for (const rule of await matchingRules(workspaceId, 'comment_keyword', comment.platform, comment.text)) {
        const config = rule.action?.config || {};
        try {
            if (rule.action?.type === 'add_lead') {
                await addLead(workspaceId, comment.platform, { id: comment.fromId, ...profile }, `Comment automation: ${rule.name || rule.id}`);
                await countRun(rule);
                continue;
            }
            if (acted) continue;
            if (rule.action?.type === 'send_dm' && config.message) {
                await privateReply(workspaceId, comment, fillPlaceholders(config.message, profile), { by: 'automation', ruleId: rule.id });
            }
            if ((rule.action?.type === 'send_dm' || rule.action?.type === 'reply_comment') && config.publicReply) {
                await publicReply(workspaceId, comment, fillPlaceholders(config.publicReply, profile), { by: 'automation', ruleId: rule.id });
            }
            acted = true;
            await ref.update({ automation: { ruleId: rule.id, ruleName: rule.name || '', at: Date.now() } });
            await countRun(rule);
        } catch (error) {
            console.error(`[Comment automation] "${rule.name || rule.id}" failed:`, (error as Error).message);
        }
    }
}

type Actor = { by: 'automation' | 'user'; ruleId?: string; uid?: string };

/** Posts a public reply and records it on the Inbox copy. */
export async function publicReply(workspaceId: string, comment: Pick<MetaComment, 'platform' | 'commentId'>, text: string, actor: Actor) {
    const id = await replyToComment(workspaceId, comment.platform, comment.commentId, text);
    await commentsCol(workspaceId)
        .doc(commentDocId(comment.platform, comment.commentId))
        .set({ status: 'replied', replies: admin.firestore.FieldValue.arrayUnion({ id, text, kind: 'public', ...actor, at: Date.now() }) }, { merge: true });
    return id;
}

/**
 * Sends the one private reply Meta allows for a comment. A transaction claims it first, so two
 * clicks (or a rule and a person) can't both send one.
 */
export async function privateReply(workspaceId: string, comment: Pick<MetaComment, 'platform' | 'commentId' | 'fromId' | 'createdAt'>, text: string, actor: Actor) {
    const ref = commentsCol(workspaceId).doc(commentDocId(comment.platform, comment.commentId));
    await ref.firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.data() || {};
        if (data.privateReplySentAt) throw new DmError('A private reply was already sent for this comment. Meta allows only one.', 409);
        if (data.privateReplyClaimedAt && data.privateReplyClaimedAt > Date.now() - 60_000) throw new DmError('A private reply for this comment is already being sent.', 409);
        tx.set(ref, { privateReplyClaimedAt: Date.now() }, { merge: true });
    });
    try {
        const id = await sendPrivateReply(workspaceId, comment.platform, comment, text);
        await ref.set(
            {
                status: 'replied',
                privateReplySentAt: Date.now(),
                privateReplyClaimedAt: admin.firestore.FieldValue.delete(),
                replies: admin.firestore.FieldValue.arrayUnion({ id, text, kind: 'private', ...actor, at: Date.now() }),
            },
            { merge: true }
        );
        return id;
    } catch (error) {
        await ref.set({ privateReplyClaimedAt: admin.firestore.FieldValue.delete() }, { merge: true });
        throw error;
    }
}
