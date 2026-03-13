import { getFirestore } from '../config/firebase.js';

/**
 * Get all automations for a workspace.
 */
export async function getAutomations(req, res) {
    try {
        const db = getFirestore();
        const { workspaceId } = req.params;

        const snapshot = await db.collection('workspaces')
            .doc(workspaceId)
            .collection('automations')
            .orderBy('createdAt', 'desc')
            .get();

        const automations = [];
        snapshot.forEach(doc => {
            automations.push(doc.data());
        });

        res.json({ automations });
    } catch (error) {
        console.error('[Automation Controller] Get automations error:', error);
        res.status(500).json({ error: 'Failed to fetch automations' });
    }
}

/**
 * Create a new automation.
 */
export async function createAutomation(req, res) {
    try {
        const db = getFirestore();
        const { workspaceId } = req.params;
        const { name, trigger, action, connections, status } = req.body;

        if (!name || !trigger || !action) {
            return res.status(400).json({ error: 'Name, Trigger, and Action are required' });
        }

        const now = new Date().toISOString();
        const automationRef = db.collection('workspaces')
            .doc(workspaceId)
            .collection('automations')
            .doc();

        const automationData = {
            id: automationRef.id,
            name,
            trigger,
            action,
            connections: connections || [],
            status: status !== undefined ? status : 'active',
            createdAt: now,
            updatedAt: now,
        };

        await automationRef.set(automationData);

        res.status(201).json({ automation: automationData });
    } catch (error) {
        console.error('[Automation Controller] Create automation error:', error);
        res.status(500).json({ error: 'Failed to create automation' });
    }
}

/**
 * Update automation status or configuration.
 */
export async function updateAutomation(req, res) {
    try {
        const db = getFirestore();
        const { workspaceId, automationId } = req.params;
        const updates = req.body;

        updates.updatedAt = new Date().toISOString();

        await db.collection('workspaces')
            .doc(workspaceId)
            .collection('automations')
            .doc(automationId)
            .update(updates);

        const updatedDoc = await db.collection('workspaces')
            .doc(workspaceId)
            .collection('automations')
            .doc(automationId)
            .get();

        res.json({ automation: updatedDoc.data() });
    } catch (error) {
        console.error('[Automation Controller] Update automation error:', error);
        res.status(500).json({ error: 'Failed to update automation' });
    }
}

/**
 * Delete an automation.
 */
export async function deleteAutomation(req, res) {
    try {
        const db = getFirestore();
        const { workspaceId, automationId } = req.params;

        await db.collection('workspaces')
            .doc(workspaceId)
            .collection('automations')
            .doc(automationId)
            .delete();

        res.json({ message: 'Automation deleted successfully' });
    } catch (error) {
        console.error('[Automation Controller] Delete automation error:', error);
        res.status(500).json({ error: 'Failed to delete automation' });
    }
}
