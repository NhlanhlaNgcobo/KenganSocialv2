import { onWebhook } from './dispatcher';
import { handleMetaMessage } from '../meta/inbound';
import { fromInstagram, fromPageFeed, handleComment, syncCommentChange } from '../meta/comments';
import { removeTikTokUser } from '../data-deletion.service';

/**
 * What each webhook event does. Event types without a handler are stored and marked `ignored`.
 * Imported once at startup (server.js).
 *
 * The stored event id (ctx.eventId) is passed on as the idempotency key: when a handler throws, the
 * dispatcher retries the same event, and automations use the key so a retry never sends twice.
 */

// Direct messages (Instagram DMs and Facebook Messenger), including echoes of the account's own messages:
// automation rules, Inbox auto-replies, the approval queue, or a human-handover pause.
onWebhook('meta', 'instagram.message', async (payload, ctx) => ({
    workspaceId: await handleMetaMessage('instagram', String(ctx.accountId || payload.entryId), payload.event, ctx.eventId),
}));
onWebhook('meta', 'page.message', async (payload, ctx) => ({
    workspaceId: await handleMetaMessage('facebook', String(ctx.accountId || payload.entryId), payload.event, ctx.eventId),
}));

// Comments on Instagram media: stored for the Inbox, then comment keyword rules.
onWebhook('meta', 'instagram.comments', async (payload, ctx) => {
    const comment = fromInstagram(String(ctx.accountId || payload.entryId), payload.value, payload.time);
    return { workspaceId: comment ? await handleComment(comment, ctx.eventId) : null };
});

// Facebook Page feed: new comments as above; edited and removed comments update the Inbox copy.
onWebhook('meta', 'page.feed', async (payload, ctx) => {
    const pageId = String(ctx.accountId || payload.entryId);
    const value = (payload.value || {}) as any;
    if (value.item !== 'comment') return; // posts, reactions and shares: nothing to do
    if (value.verb === 'add') {
        const comment = fromPageFeed(pageId, value);
        return { workspaceId: comment ? await handleComment(comment, ctx.eventId) : null };
    }
    if (value.verb === 'edited' || value.verb === 'remove') {
        return { workspaceId: await syncCommentChange('facebook', pageId, String(value.comment_id || ''), value.verb, value.message) };
    }
});

// A TikTok user removed KenganSocial: delete their connection and its data (Privacy Policy, Data Deletion page).
onWebhook('tiktok', 'authorization.removed', async (payload, ctx) => {
    const openId = String(ctx.accountId || payload.userOpenId || '');
    if (!openId) return;
    const { workspaceIds } = await removeTikTokUser(openId, (payload.content as any)?.reason);
    return { workspaceId: workspaceIds[0] ?? null };
});
