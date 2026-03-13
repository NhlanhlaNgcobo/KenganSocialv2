import { getFirestore } from '../config/firebase.js';

/**
 * Get all leads for a workspace.
 */
export async function getLeads(req, res) {
    try {
        const db = getFirestore();
        const { workspaceId } = req.params;

        const snapshot = await db.collection('workspaces')
            .doc(workspaceId)
            .collection('leads')
            .orderBy('createdAt', 'desc')
            .get();

        const leads = [];
        snapshot.forEach(doc => {
            leads.push(doc.data());
        });

        res.json({ leads });
    } catch (error) {
        console.error('[Leads Controller] Get leads error:', error);
        res.status(500).json({ error: 'Failed to fetch leads' });
    }
}

/**
 * Add a new lead (Usually triggered by an automation).
 */
export async function addLead(req, res) {
    try {
        const db = getFirestore();
        const { workspaceId } = req.params;
        const { name, email, platform, source, tag, metadata } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const now = new Date().toISOString();
        const leadRef = db.collection('workspaces')
            .doc(workspaceId)
            .collection('leads')
            .doc();

        const leadData = {
            id: leadRef.id,
            name: name || 'Anonymous',
            email,
            platform: platform || 'Unknown',
            source: source || 'Organic',
            tag: tag || 'New Lead',
            metadata: metadata || {},
            createdAt: now,
            updatedAt: now,
        };

        await leadRef.set(leadData);

        res.status(201).json({ lead: leadData });
    } catch (error) {
        console.error('[Leads Controller] Add lead error:', error);
        res.status(500).json({ error: 'Failed to add lead' });
    }
}

/**
 * Update lead (e.g., tagging or adding notes).
 */
export async function updateLead(req, res) {
    try {
        const db = getFirestore();
        const { workspaceId, leadId } = req.params;
        const updates = req.body;

        updates.updatedAt = new Date().toISOString();

        await db.collection('workspaces')
            .doc(workspaceId)
            .collection('leads')
            .doc(leadId)
            .update(updates);

        const updatedDoc = await db.collection('workspaces')
            .doc(workspaceId)
            .collection('leads')
            .doc(leadId)
            .get();

        res.json({ lead: updatedDoc.data() });
    } catch (error) {
        console.error('[Leads Controller] Update lead error:', error);
        res.status(500).json({ error: 'Failed to update lead' });
    }
}
