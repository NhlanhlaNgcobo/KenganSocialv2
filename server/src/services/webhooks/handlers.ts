import { onWebhook } from './dispatcher';
import { handleInstagramMessage } from '../instagram-dm';
import { removeTikTokUser } from '../data-deletion.service';

/**
 * What each webhook event does. Event types without a handler are stored and marked `ignored`.
 * Imported once at startup (server.js).
 */

// Instagram direct messages: automation rules, Inbox auto-replies, or the approval queue.
onWebhook('meta', 'instagram.message', async (payload, ctx) => {
    const workspaceId = await handleInstagramMessage(String(ctx.accountId || payload.entryId), payload.event);
    return { workspaceId };
});

// A TikTok user removed KenganSocial: delete their connection and its data (Privacy Policy, Data Deletion page).
onWebhook('tiktok', 'authorization.removed', async (payload, ctx) => {
    const openId = String(ctx.accountId || payload.userOpenId || '');
    if (!openId) return;
    const { workspaceIds } = await removeTikTokUser(openId, (payload.content as any)?.reason);
    return { workspaceId: workspaceIds[0] ?? null };
});
