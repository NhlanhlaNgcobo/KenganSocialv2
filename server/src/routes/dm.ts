import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { db } from '../utils/firestore';
import admin from 'firebase-admin';
import { redis } from '../utils/redis';
import axios from 'axios';
import { OpenAI } from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'sk-placeholder-key',
});

const router = express.Router();
const META_APP_SECRET = process.env.META_APP_SECRET || '';

// Auth Middleware
import { withWorkspace } from '../middleware/withWorkspace';

// ─────────────────────────────────────────────────────────────────────────────
// AUTOMATIONS CONTROLLERS
// ─────────────────────────────────────────────────────────────────────────────

router.post('/automations', withWorkspace, async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId;
    const plan = (req as any).plan;
    if (plan === 'starter') return res.status(402).json({ error: 'Upgrade to Nano+ to create Automations' });

    const { platform, trigger, keyword, replyTemplate } = req.body;
    const autoRef = db.collection('workspaces').doc(workspaceId).collection('dmAutomations').doc();

    const data = {
        platform, trigger, keyword: keyword?.toLowerCase() || null, replyTemplate,
        isActive: true, sentCount: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    };
    await autoRef.set(data);
    res.json({ success: true, id: autoRef.id, ...data });
});

router.get('/automations', withWorkspace, async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId;
    const snap = await db.collection('workspaces').doc(workspaceId).collection('dmAutomations').get();
    res.json({ success: true, automations: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
});

router.put('/automations/:id', withWorkspace, async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId;
    const { isActive, replyTemplate, keyword } = req.body;
    const ref = db.collection('workspaces').doc(workspaceId).collection('dmAutomations').doc(req.params.id);
    await ref.update({ ...(isActive !== undefined && { isActive }), ...(replyTemplate && { replyTemplate }), ...(keyword && { keyword }) });
    res.json({ success: true });
});

router.delete('/automations/:id', withWorkspace, async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId;
    await db.collection('workspaces').doc(workspaceId).collection('dmAutomations').doc(req.params.id).delete();
    res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// QUEUE & INBOX CONTROLLERS
// ─────────────────────────────────────────────────────────────────────────────

router.get('/queue', withWorkspace, async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId;
    const plan = (req as any).plan;
    if (plan === 'starter' || plan === 'nano') return res.status(402).json({ error: 'Upgrade to Creator+ for API Queue' });

    const snap = await db.collection('workspaces').doc(workspaceId).collection('dmQueue')
        .where('status', '==', 'pending').limit(50).get();

    res.json({ success: true, queue: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
});

async function sendInstagramDM(workspaceId: string, senderId: string, text: string, igUserId: string, accessToken: string) {
    // 1. Check strict 2-second rate limit using Redis simple lock
    const lockKey = `dm:lock:${workspaceId}`;
    const isLocked = await redis.set(lockKey, '1', 'PX', 2000, 'NX');
    if (!isLocked) throw new Error('Rate limit exceeded: 1 message per 2 seconds');

    // 2. Abuse check: >10 identical messages in 1 hour
    const hash = crypto.createHash('sha256').update(text).digest('hex');
    const abuseKey = `dm:abuse:${workspaceId}:${hash}`;
    const identicalCount = await redis.incr(abuseKey);
    if (identicalCount === 1) await redis.expire(abuseKey, 3600); // 1 hour TTL

    if (identicalCount > 10) {
        // Lock DM sending for 24h
        await redis.set(`dm:locked:${workspaceId}`, '1', 'EX', 86400);
        throw new Error('Spam protection: Identical message limit reached. DM disabled for 24h');
    }

    const locked = await redis.get(`dm:locked:${workspaceId}`);
    if (locked) throw new Error('Account DM sending is currently locked for 24 hours');

    // 3. Send
    await axios.post(`https://graph.facebook.com/v18.0/${igUserId}/messages`, {
        recipient: { id: senderId },
        message: { text }
    }, { params: { access_token: accessToken } });

    // 4. Log
    const today = new Date().toISOString().split('T')[0];
    await redis.incr(`dm:sent:${workspaceId}:${today}`);
}

router.post('/queue/:id/send', withWorkspace, async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId;
    const { id } = req.params;

    const ref = db.collection('workspaces').doc(workspaceId).collection('dmQueue').doc(id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Message not found' });

    const data = doc.data()!;
    // In production, correctly fetch token/igUserId from unified workspace connections
    const connRaw = (await db.collection('workspaces').doc(workspaceId).collection('connections').doc('instagram').get()).data() || {};

    try {
        await sendInstagramDM(workspaceId, data.senderId, data.aiSuggestedReply, connRaw.igUserId, connRaw.accessToken);
        await ref.update({ status: 'sent', sentAt: admin.firestore.FieldValue.serverTimestamp() });
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/queue/:id/edit-send', withWorkspace, async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId;
    const { id } = req.params;
    const { text } = req.body;

    const ref = db.collection('workspaces').doc(workspaceId).collection('dmQueue').doc(id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Message not found' });

    const data = doc.data()!;
    const connRaw = (await db.collection('workspaces').doc(workspaceId).collection('connections').doc('instagram').get()).data() || {};

    try {
        await sendInstagramDM(workspaceId, data.senderId, text, connRaw.igUserId, connRaw.accessToken);
        await ref.update({ status: 'sent', sentAt: admin.firestore.FieldValue.serverTimestamp(), aiSuggestedReply: text });
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/queue/:id/dismiss', withWorkspace, async (req: Request, res: Response) => {
    const workspaceId = (req as any).workspaceId;
    await db.collection('workspaces').doc(workspaceId).collection('dmQueue').doc(req.params.id).update({ status: 'dismissed' });
    res.json({ success: true });
});


// ─────────────────────────────────────────────────────────────────────────────
// INSTAGRAM WEBHOOK
// ─────────────────────────────────────────────────────────────────────────────

router.get('/webhook/instagram', (req: Request, res: Response) => {
    // Webhook verification
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

router.post('/webhook/instagram', async (req: Request, res: Response) => {
    // 1. Signature validation
    const signature = req.headers['x-hub-signature-256'] as string;
    if (META_APP_SECRET && signature) {
        const hash = crypto.createHmac('sha256', META_APP_SECRET).update(JSON.stringify(req.body)).digest('hex');
        if (`sha256=${hash}` !== signature) return res.sendStatus(401);
    }

    const { entry } = req.body;
    if (!entry) return res.sendStatus(200);

    for (const ent of entry) {
        const igUserId = ent.id;
        const messages = ent.messaging;
        if (!messages) continue;

        // Mock lookup workspaceId from igUserId
        // In prod this would be standard relational db or cached map
        const workspaceId = 'mock-workspace-id';
        const connData = { igUserId, accessToken: 'mock' };

        for (const msg of messages) {
            const senderId = msg.sender.id;
            const text = msg.message?.text?.trim() || '';
            const lowerText = text.toLowerCase();

            // 2. Automatic Opt-Out
            const optOutWords = ['stop', 'unsubscribe', 'remove', 'no'];
            if (optOutWords.includes(lowerText)) {
                await db.collection('workspaces').doc(workspaceId).collection('dmOptOuts').doc(senderId).set({ addedAt: new Date() });
                continue; // Never process further
            }

            // Check Opt-out suppression list
            const isOptedOut = await db.collection('workspaces').doc(workspaceId).collection('dmOptOuts').doc(senderId).get();
            if (isOptedOut.exists) continue;

            // 3. Find Automations
            const automations = await db.collection('workspaces').doc(workspaceId).collection('dmAutomations')
                .where('isActive', '==', true).get();

            let matchedAuto = null;
            for (const doc of automations.docs) {
                const auto = doc.data();
                if (auto.keyword && lowerText.includes(auto.keyword)) {
                    matchedAuto = { id: doc.id, ...auto };
                    break;
                }
            }

            if (matchedAuto) {
                // Auto reply hit
                try {
                    await sendInstagramDM(workspaceId, senderId, matchedAuto.replyTemplate, igUserId, connData.accessToken);
                    await db.collection('workspaces').doc(workspaceId).collection('dmAutomations').doc(matchedAuto.id).update({
                        sentCount: admin.firestore.FieldValue.increment(1)
                    });
                } catch (e: any) {
                    console.error('Auto reply failed', e.message);
                }
            } else {
                // Generate Smart AI Reply and push to specific Inbox review queue
                const aiRes = await openai.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: 'You are helping a creator manage their DMs. Write a short, engaging 1-sentence reply to this fan message.' },
                        { role: 'user', content: text }
                    ]
                });
                const suggestedReply = aiRes.choices[0]?.message?.content || `Thanks for reaching out!`;

                await db.collection('workspaces').doc(workspaceId).collection('dmQueue').add({
                    senderId,
                    senderName: 'IG User ' + senderId, // Normally fetch profile
                    senderAvatar: '',
                    originalMessage: text,
                    aiSuggestedReply: suggestedReply,
                    platform: 'instagram',
                    status: 'pending',
                    receivedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }
        }
    }

    res.sendStatus(200);
});

export default router;
