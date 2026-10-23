import { FieldValue } from 'firebase-admin/firestore';
import { findConnections } from '../connection-lookup';
import { DmError, fillPlaceholders, handoverUntil, replyToComment, sendPrivateReply, workspaceRef, type MetaChannel } from './messaging';
import { automationsEnabled, hasLeads, workspacePlan } from './plan-access';
import { addLead, claimRun, completeRun, countRun, isRetryable, markStep, matchingRules, recordRuleFailure, releaseRun, type RunClaim } from './rules';

/**
 * Comments on Instagram media (webhook instagram.comments) and Facebook Page posts (page.feed with
 * item "comment"). Each new comment is stored once in workspaces/{id}/inboxComments for the Inbox,
 * then comment keyword rules run: a public reply, a private reply (comment-to-DM), or adding a lead.
 * The account's own comments, including the replies we post, are skipped, so rules can't loop.
 *
 * Retries: a temporary send failure is rethrown so the webhook dispatcher retries the event. The
 * stored comment records when its rules finished (rulesDoneAt), so a retry after a crash still runs
 * them, and each rule run is claimed per event (rules.ts claimRun) with its steps (private, public)
 * recorded, so a retry only does what is missing.
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
export async function handleComment(comment: MetaComment, eventKey: string = commentDocId(comment.platform, comment.commentId)): Promise<string | null> {
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
            rulesDoneAt: null,
            receivedAt: FieldValue.serverTimestamp(),
        });
    } catch (error: any) {
        if (error.code !== 6) throw error; // 6 = ALREADY_EXISTS: stored by an earlier attempt
        const existing = (await ref.get()).data() || {};
        // Finished before, or stored before rulesDoneAt existed (rules ran then): nothing left to do.
        if (existing.rulesDoneAt || existing.rulesDoneAt === undefined) return workspaceId;
    }
    if (comment.text.trim()) {
        const plan = await workspacePlan(workspaceId);
        if (automationsEnabled(plan)) await runCommentRules(workspaceId, comment, ref, eventKey, hasLeads(plan));
    }
    await ref.update({ rulesDoneAt: Date.now() });
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

async function runCommentRules(workspaceId: string, comment: MetaComment, ref: FirebaseFirestore.DocumentReference, eventKey: string, leads: boolean) {
    const profile = { name: comment.fromName, username: comment.fromUsername };
    let acted = false; // one public reply and one private reply per comment, from the first matching rule
    let retryError: unknown = null;
    for (const rule of await matchingRules(workspaceId, 'comment_keyword', comment.platform, comment.text)) {
        const type = rule.action?.type;
        const config = rule.action?.config || {};
        const isLead = type === 'add_lead';
        if (!isLead && type !== 'send_dm' && type !== 'reply_comment') continue;
        if (!isLead && acted) continue;
        if (isLead && !leads) {
            await recordRuleFailure(rule.ref, 'Not run: adding people to Leads is part of the Agency plan.');
            continue;
        }
        let claim: RunClaim | null = null;
        try {
            claim = await claimRun(workspaceId, rule.id, comment.platform, comment.fromId, eventKey);
            if (claim.decision !== 'run') {
                if (!isLead) acted = true; // done earlier, or this person got this rule's reply recently
                continue;
            }
            if (isLead) {
                await addLead(workspaceId, comment.platform, { id: comment.fromId, ...profile }, `Comment automation: ${rule.name || rule.id}`);
            } else {
                await runReplySteps(workspaceId, comment, claim, rule.id, type === 'send_dm' ? config.message : undefined, config.publicReply, profile);
                acted = true;
                await ref.update({ automation: { ruleId: rule.id, ruleName: rule.name || '', at: Date.now() } });
            }
            await completeRun(claim);
            await countRun(rule);
        } catch (error) {
            console.error(`[Comment automation] "${rule.name || rule.id}" failed:`, (error as Error).message);
            await recordRuleFailure(rule.ref, error);
            if (isRetryable(error)) {
                retryError ??= error;
                if (!isLead) acted = true; // no other rule replies while this one is retried
            } else if (claim) {
                await releaseRun(claim);
            }
        }
    }
    if (retryError) throw retryError;
}

/** The private reply, then the public reply, each skipped if an earlier attempt already did it. */
async function runReplySteps(
    workspaceId: string,
    comment: MetaComment,
    claim: RunClaim,
    ruleId: string,
    privateText: string | undefined,
    publicText: string | undefined,
    profile: { name: string; username: string }
) {
    const actor: Actor = { by: 'automation', ruleId };
    if (privateText && !claim.steps.private) {
        // The owner is talking to this person by hand: no automatic DM (the public reply is still fine).
        const handedOver = (await handoverUntil(workspaceId, comment.platform, comment.fromId)) > Date.now();
        if (!handedOver) {
            try {
                await privateReply(workspaceId, comment, fillPlaceholders(privateText, profile), actor);
            } catch (error) {
                if (!(error instanceof DmError && (error.code === 'already_sent' || error.code === 'duplicate'))) throw error;
            }
        }
        await markStep(claim, 'private');
    }
    if (publicText && !claim.steps.public) {
        try {
            await publicReply(workspaceId, comment, fillPlaceholders(publicText, profile), actor);
        } catch (error) {
            if (!(error instanceof DmError && error.code === 'duplicate')) throw error;
        }
        await markStep(claim, 'public');
    }
}

type Actor = { by: 'automation' | 'user'; ruleId?: string; uid?: string };

/** Posts a public reply and records it on the Inbox copy. */
export async function publicReply(workspaceId: string, comment: Pick<MetaComment, 'platform' | 'commentId'>, text: string, actor: Actor) {
    const id = await replyToComment(workspaceId, comment.platform, comment.commentId, text, { automated: actor.by === 'automation' });
    await commentsCol(workspaceId)
        .doc(commentDocId(comment.platform, comment.commentId))
        .set({ status: 'replied', replies: FieldValue.arrayUnion({ id, text, kind: 'public', ...actor, at: Date.now() }) }, { merge: true });
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
        if (data.privateReplySentAt) throw new DmError('A private reply was already sent for this comment. Meta allows only one.', 409, 'already_sent');
        if (data.privateReplyClaimedAt && data.privateReplyClaimedAt > Date.now() - 60_000) {
            throw new DmError('A private reply for this comment is already being sent.', 409, 'burst', true);
        }
        tx.set(ref, { privateReplyClaimedAt: Date.now() }, { merge: true });
    });
    try {
        const id = await sendPrivateReply(workspaceId, comment.platform, comment, text, { automated: actor.by === 'automation' });
        await ref.set(
            {
                status: 'replied',
                privateReplySentAt: Date.now(),
                privateReplyClaimedAt: FieldValue.delete(),
                replies: FieldValue.arrayUnion({ id, text, kind: 'private', ...actor, at: Date.now() }),
            },
            { merge: true }
        );
        return id;
    } catch (error) {
        await ref.set({ privateReplyClaimedAt: FieldValue.delete() }, { merge: true });
        throw error;
    }
}
