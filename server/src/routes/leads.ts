import express, { Request, Response, NextFunction } from 'express';
import { db } from '../utils/firestore';
import { FieldValue, Query, DocumentData } from 'firebase-admin/firestore';
import { processLeadScore } from '../services/leads/scoreService';
import { CHAT_MODEL, chatClient } from '../services/llm-client.js';
import { withWorkspace } from '../middleware/withWorkspace';
import { requirePlan } from '../middleware/planGate';

// mergeParams: the workspace comes from /api/workspaces/:workspaceId/leads.
const router = express.Router({ mergeParams: true });
const openai = chatClient;

type Handler = (req: Request, res: Response) => Promise<unknown>;

/** Express 4 does not catch async errors: without this, a Firestore error crashes the server. */
const route = (handler: Handler) => (req: Request, res: Response, next: NextFunction) =>
    handler(req, res).catch((error: any) => {
        console.error(`[Leads] ${req.method} ${req.path} failed:`, error.message);
        if (res.headersSent) return next(error);
        res.status(error.status || 500).json({ error: error.status ? error.message : 'Something went wrong with leads. Try again.' });
    });

function requireWorkspace(req: Request, res: Response, next: NextFunction) {
    if (!(req as any).workspaceId) return res.status(403).json({ error: 'WORKSPACE_REQUIRED' });
    next();
}

const guard = [withWorkspace, requireWorkspace, requirePlan('agency')];

const leadsOf = (req: Request) => db.collection('workspaces').doc((req as any).workspaceId).collection('leads');

/** Fields a client may change on a lead. */
const EDITABLE = ['status', 'notes', 'tags', 'displayName', 'username', 'platform', 'followersCount', 'signals', 'industryMatch', 'hasPreviousCollab'];
const STATUSES = ['prospect', 'contacted', 'negotiating', 'closed', 'lost'];
const PLATFORMS = ['instagram', 'facebook', 'tiktok', 'youtube', 'email', 'whatsapp', 'other'];

/** Validates a manually-added lead. Returns { value } or { error }. */
function sanitizeNewLead(body: any): { value?: Record<string, unknown>; error?: string } {
    const username = String(body?.username || '').trim().replace(/^@/, '').slice(0, 100);
    if (!username) return { error: 'Add the lead\'s username.' };
    const platform = String(body?.platform || 'instagram').toLowerCase();
    if (!PLATFORMS.includes(platform)) return { error: 'Pick a supported platform.' };
    const followers = Number(body?.followersCount ?? 0);
    if (!Number.isFinite(followers) || followers < 0) return { error: 'Followers must be a positive number.' };
    const status = STATUSES.includes(body?.status) ? body.status : 'prospect';
    return {
        value: {
            username,
            platform,
            displayName: String(body?.displayName || '').trim().slice(0, 120) || username,
            followersCount: Math.floor(followers),
            notes: String(body?.notes || '').slice(0, 5000),
            status,
            tags: Array.isArray(body?.tags) ? body.tags.filter((t: unknown) => typeof t === 'string').slice(0, 20) : ['manual'],
            industryMatch: !!body?.industryMatch,
            hasPreviousCollab: !!body?.hasPreviousCollab,
            signals: { totalLikes: 0, totalComments: 0, dmOpened: false, dmReplied: false, linkClicked: false, bookingMade: false, storyReply: false },
        },
    };
}

const csvCell = (value: unknown) => {
    const text = value === undefined || value === null ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

router.get('/', ...guard, route(async (req, res) => {
    const { tier, status, sort } = req.query;
    let query: Query<DocumentData> = leadsOf(req);
    if (tier && tier !== 'all') query = query.where('tier', '==', tier);
    if (status && status !== 'all') query = query.where('status', '==', status);
    if (sort === 'score_desc') query = query.orderBy('score', 'desc');
    const snap = await query.limit(100).get();
    res.json({ success: true, leads: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
}));

router.post('/', ...guard, route(async (req, res) => {
    const input = sanitizeNewLead(req.body);
    if (input.error) return res.status(400).json({ error: input.error });
    const processedLead = processLeadScore({
        ...(input.value as any),
        source: 'Manual',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    });
    const ref = leadsOf(req).doc();
    await ref.set(processedLead);
    res.json({ success: true, id: ref.id, ...processedLead });
}));

// Registered before /:id so "export" is not read as a lead id.
router.get('/export', ...guard, route(async (req, res) => {
    const snap = await leadsOf(req).get();
    const rows = snap.docs.map((d) => {
        const val = d.data();
        return [val.username, val.platform, val.score, val.tier, val.status].map(csvCell).join(',');
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
    res.send(['Username,Platform,Score,Tier,Status', ...rows].join('\n'));
}));

router.post('/import', ...guard, route(async (req, res) => {
    const leads: any[] = Array.isArray(req.body?.leads) ? req.body.leads.slice(0, 500) : [];
    const batch = db.batch();
    leads.forEach((l) => {
        batch.set(leadsOf(req).doc(), processLeadScore({ status: 'prospect', ...l, createdAt: FieldValue.serverTimestamp() }));
    });
    await batch.commit();
    res.json({ success: true, count: leads.length });
}));

router.post('/import-engagers', ...guard, route(async (_req, res) => {
    // Engager import (pulling people who liked/commented on a post) is not built yet.
    res.status(501).json({ error: 'Not available yet: importing engagers is coming soon.' });
}));

router.get('/:id', ...guard, route(async (req, res) => {
    const snap = await leadsOf(req).doc(String(req.params.id)).get();
    if (!snap.exists) return res.status(404).json({ error: 'Lead not found' });
    res.json({ success: true, lead: { id: snap.id, ...snap.data() } });
}));

router.patch('/:id', ...guard, route(async (req, res) => {
    const ref = leadsOf(req).doc(String(req.params.id));
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Lead not found' });

    const updates = Object.fromEntries(Object.entries(req.body || {}).filter(([key]) => EDITABLE.includes(key)));
    if (updates.status !== undefined && !STATUSES.includes(updates.status as string)) {
        return res.status(400).json({ error: 'Invalid lead status' });
    }
    await ref.update({ ...updates, updatedAt: FieldValue.serverTimestamp() });

    if (updates.signals || updates.followersCount) {
        const scored = processLeadScore({ ...(snap.data() as any), ...updates });
        await ref.update({ score: scored.score, tier: scored.tier });
    }
    res.json({ success: true });
}));

router.post('/:id/recalculate', ...guard, route(async (req, res) => {
    const ref = leadsOf(req).doc(String(req.params.id));
    const docSnap = await ref.get();
    if (!docSnap.exists) return res.status(404).json({ error: 'Lead not found' });
    const scored = processLeadScore(docSnap.data() as any);
    await ref.update({ score: scored.score, tier: scored.tier, updatedAt: FieldValue.serverTimestamp() });
    res.json({ success: true, score: scored.score, tier: scored.tier });
}));

/** Drafts an outreach DM with AI and puts it in the Inbox approval queue. */
router.post('/:id/dm', ...guard, route(async (req, res) => {
    const docSnap = await leadsOf(req).doc(String(req.params.id)).get();
    if (!docSnap.exists) return res.status(404).json({ error: 'Lead not found' });
    const lead = docSnap.data() || {};

    // Instagram only lets a business message someone who has messaged it (an Instagram-scoped id
    // and an open 24h window). Leads created from DMs carry that id as externalId; others can't be messaged.
    if (!lead.externalId || (lead.platform && lead.platform !== 'instagram')) {
        return res.status(409).json({
            error: 'This lead cannot be messaged from here: Instagram only allows replies to people who have DMed you first. Leads added from DM automations can be messaged.',
        });
    }

    const aiRes = await openai.chat.completions.create({
        model: CHAT_MODEL,
        messages: [
            {
                role: 'system',
                content: 'You write short, friendly, specific cold outreach DMs for a creator agency. Two or three sentences, no hashtags, no emojis unless natural. Reply with the message only.',
            },
            {
                role: 'user',
                content: `Prospect: ${JSON.stringify({ username: lead.username, displayName: lead.displayName, platform: lead.platform, followers: lead.followersCount, tags: lead.tags, notes: lead.notes })}`,
            },
        ],
    });
    const reply = aiRes.choices[0]?.message?.content?.trim() || `Hey ${lead.username}, would love to collaborate!`;

    await db.collection('workspaces').doc((req as any).workspaceId).collection('dmQueue').add({
        leadId: docSnap.id,
        senderId: String(lead.externalId),
        senderName: lead.displayName || lead.username || 'Prospect',
        originalMessage: `Outreach draft for @${lead.username || 'prospect'}`,
        aiSuggestedReply: reply,
        platform: lead.platform || 'instagram',
        status: 'pending',
        receivedAt: FieldValue.serverTimestamp(),
    });

    res.json({ success: true, message: 'DM added to the Inbox for approval' });
}));

export default router;
