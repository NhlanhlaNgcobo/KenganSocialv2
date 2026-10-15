import express, { Request, Response, NextFunction } from 'express';
import { db } from '../utils/firestore';
import admin from 'firebase-admin';
import { processLeadScore, Lead } from '../services/leads/scoreService';
import { CHAT_MODEL, chatClient } from '../services/llm-client.js';

const router = express.Router();
const openai = chatClient;

import { withWorkspace } from '../middleware/withWorkspace';
import { requirePlan } from '../middleware/planGate';

router.get('/', withWorkspace, requirePlan('agency'), async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId;
    const { tier, status, sort } = req.query;

    let query: admin.firestore.Query<admin.firestore.DocumentData> = db.collection('workspaces').doc(workspaceId).collection('leads');

    if (tier && tier !== 'all') query = query.where('tier', '==', tier);
    if (status && status !== 'all') query = query.where('status', '==', status);

    if (sort === 'score_desc') query = query.orderBy('score', 'desc');

    const snap = await query.limit(100).get();
    res.json({ success: true, leads: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
});

router.post('/', withWorkspace, requirePlan('agency'), async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId;
    const leadRaw = req.body;

    // Process initial score
    const processedLead = processLeadScore({
        ...leadRaw,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const ref = db.collection('workspaces').doc(workspaceId).collection('leads').doc();
    await ref.set(processedLead);
    res.json({ success: true, id: ref.id, ...processedLead });
});

router.get('/:id', withWorkspace, requirePlan('agency'), async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId;
    const snap = await db.collection('workspaces').doc(workspaceId).collection('leads').doc(req.params.id as string).get();
    if (!snap.exists) return res.status(404).json({ error: 'Lead not found' });
    res.json({ success: true, lead: snap.data() });
});

router.patch('/:id', withWorkspace, requirePlan('agency'), async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId;
    const updates = req.body;

    const ref = db.collection('workspaces').doc(workspaceId).collection('leads').doc(req.params.id as string);
    await ref.update({
        ...updates,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Attempt re-score if raw signals were pushed mapped dynamically optionally (would be better isolated, but fine).
    if (updates.signals || updates.followersCount) {
        const docSnap = await ref.get();
        if (docSnap.exists) {
            const scored = processLeadScore(docSnap.data() as any);
            await ref.update({ score: scored.score, tier: scored.tier });
        }
    }
    res.json({ success: true });
});

router.post('/:id/recalculate', withWorkspace, requirePlan('agency'), async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId;
    const ref = db.collection('workspaces').doc(workspaceId).collection('leads').doc(req.params.id as string);
    const docSnap = await ref.get();

    if (!docSnap.exists) return res.status(404).json({ error: 'Lead not found' });

    const leadStr = processLeadScore(docSnap.data() as any);
    await ref.update({ score: leadStr.score, tier: leadStr.tier, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    res.json({ success: true, score: leadStr.score, tier: leadStr.tier });
});

router.post('/import', withWorkspace, requirePlan('agency'), async (req: Request, res: Response) => {
    // Basic CSV JSON map import logic mock
    const workspaceId = (req as any).workspaceId;
    const { leads = [] } = req.body; // Expect JSON array mapping from parsed CSV in frontend
    const batch = db.batch();

    leads.forEach((l: any) => {
        const ref = db.collection('workspaces').doc(workspaceId).collection('leads').doc();
        batch.set(ref, processLeadScore({ ...l, createdAt: admin.firestore.FieldValue.serverTimestamp() }));
    });

    await batch.commit();
    res.json({ success: true, count: leads.length });
});

router.get('/export', withWorkspace, requirePlan('agency'), async (req: Request, res: Response) => {
    // Provide JSON string format mappings
    const workspaceId = (req as any).workspaceId;
    const snap = await db.collection('workspaces').doc(workspaceId).collection('leads').get();
    // Return mock CSV response
    res.setHeader('Content-Type', 'text/csv');
    res.send('Username,Platform,Score,Tier,Status\n' + snap.docs.map(d => {
        const val = d.data();
        return `${val.username},${val.platform},${val.score},${val.tier},${val.status}`;
    }).join('\n'));
});

// Trigger intelligent DM automatically bridging automated endpoints internally using GPT contextual pipeline 
router.post('/:id/dm', withWorkspace, requirePlan('agency'), async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId;
    const ref = db.collection('workspaces').doc(workspaceId).collection('leads').doc(req.params.id as string);
    const docSnap = await ref.get();

    if (!docSnap.exists) return res.status(404).json({ error: 'Lead not found' });
    const lead = docSnap.data();

    try {
        const aiRes = await openai.chat.completions.create({
            model: CHAT_MODEL,
            messages: [
                { role: 'system', content: `You are an Agency Sales Rep. Write a persuasive cold outreach DM to a specific prospect. Context: ${JSON.stringify(lead)}` }
            ]
        });
        const reply = aiRes.choices[0]?.message?.content || `Hey ${lead?.username}, let's collaborate!`;

        // Send to DM queue router natively avoiding duplicate logic
        await db.collection('workspaces').doc(workspaceId).collection('dmQueue').add({
            senderId: lead?.username || lead?.id,
            senderName: lead?.displayName || lead?.username,
            originalMessage: '<OUTREACH INITIATION>',
            aiSuggestedReply: reply,
            platform: lead?.platform || 'instagram',
            status: 'pending',
            receivedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({ success: true, message: 'DM added to queue for approval' });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/import-engagers', withWorkspace, requirePlan('agency'), async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId;
    const { platform, postId } = req.body; // Trigger to scrape comments
    // Mock scraping -> Auto inject prospect leads into database scoring engine mapped
    try {
        const prospectA = processLeadScore({
            username: `engager_${Math.random()}`, platform, displayName: 'New Prospect',
            followersCount: 1500, industryMatch: true, status: 'prospect', tags: ['auto-import'],
            hasPreviousCollab: false,
            signals: { totalLikes: 1, totalComments: 2, storyReply: false } as any
        });

        await db.collection('workspaces').doc(workspaceId).collection('leads').add(prospectA);
        res.json({ success: true, added: 1 });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
