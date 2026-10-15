import { getFirestore } from '../config/firebase.js';

const STATUSES = ['active', 'paused'];
const TRIGGER_TYPES = ['dm_keyword'];
const ACTION_TYPES = ['send_dm', 'add_lead'];

/**
 * Normalises and validates trigger/action input. Only the fields the automation runner
 * (services/instagram-dm.ts) reads are kept, so arbitrary client data is never stored.
 * Returns { value } or { error }.
 */
function sanitizeRule({ trigger, action }) {
    if (!trigger || !TRIGGER_TYPES.includes(trigger.type)) {
        return { error: 'Pick a supported trigger.' };
    }
    const rawKeywords = Array.isArray(trigger.config?.keywords) ? trigger.config.keywords : [];
    const keywords = rawKeywords
        .map((k) => String(k || '').trim().toLowerCase().slice(0, 100))
        .filter(Boolean)
        .slice(0, 50);
    if (keywords.length === 0) {
        return { error: 'Add at least one keyword.' };
    }

    if (!action || !ACTION_TYPES.includes(action.type)) {
        return { error: 'Pick a supported action.' };
    }
    const actionConfig = {};
    if (action.type === 'send_dm') {
        const message = String(action.config?.message || '').trim().slice(0, 1000);
        if (!message) return { error: 'Write the message to send.' };
        actionConfig.message = message;
    }

    return {
        value: {
            trigger: { type: trigger.type, config: { keywords } },
            action: { type: action.type, config: actionConfig },
        },
    };
}

function sanitizeConnections(connections) {
    return Array.isArray(connections)
        ? connections.filter((c) => typeof c === 'string' && c).slice(0, 50)
        : [];
}

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
        const rule = sanitizeRule({ trigger, action });
        if (rule.error) return res.status(400).json({ error: rule.error });

        const now = new Date().toISOString();
        const automationRef = db.collection('workspaces')
            .doc(workspaceId)
            .collection('automations')
            .doc();

        const automationData = {
            id: automationRef.id,
            name: String(name).trim().slice(0, 120),
            trigger: rule.value.trigger,
            action: rule.value.action,
            connections: sanitizeConnections(connections),
            status: STATUSES.includes(status) ? status : 'active',
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
        const body = req.body || {};
        const docRef = db.collection('workspaces')
            .doc(workspaceId)
            .collection('automations')
            .doc(automationId);

        const existing = await docRef.get();
        if (!existing.exists) {
            return res.status(404).json({ error: 'Automation not found' });
        }

        // Whitelist: only these fields can be changed (no mass assignment of id, createdAt, runCount...).
        const updates = {};
        if (body.name !== undefined) {
            const name = String(body.name || '').trim().slice(0, 120);
            if (!name) return res.status(400).json({ error: 'Name cannot be empty' });
            updates.name = name;
        }
        if (body.status !== undefined) {
            if (!STATUSES.includes(body.status)) return res.status(400).json({ error: 'Invalid status' });
            updates.status = body.status;
        }
        if (body.trigger !== undefined || body.action !== undefined) {
            const current = existing.data();
            const rule = sanitizeRule({ trigger: body.trigger ?? current.trigger, action: body.action ?? current.action });
            if (rule.error) return res.status(400).json({ error: rule.error });
            updates.trigger = rule.value.trigger;
            updates.action = rule.value.action;
        }
        if (body.connections !== undefined) {
            updates.connections = sanitizeConnections(body.connections);
        }

        updates.updatedAt = new Date().toISOString();

        await docRef.update(updates);

        const updatedDoc = await docRef.get();

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
