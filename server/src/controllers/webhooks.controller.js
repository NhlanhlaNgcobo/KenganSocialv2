import { getFirestore } from '../config/firebase.js';

// META (Facebook/Instagram) Webhook Verification
export const verifyMetaWebhook = (req, res) => {
    const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN || 'kengan_social_verify_token';
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('[Meta Webhook] WEBHOOK_VERIFIED');
            res.status(200).send(challenge);
        } else {
            console.error('[Meta Webhook] Verification failed!');
            res.sendStatus(403);
        }
    } else {
        res.sendStatus(400);
    }
};

// Handle Incoming Event from Meta (DMs, etc.)
export const handleMetaWebhook = async (req, res) => {
    try {
        const body = req.body;

        if (body.object === 'instagram' || body.object === 'page') {
            const db = getFirestore();

            // Returns a 200 OK fast to acknowledge receipt to Meta
            res.status(200).send('EVENT_RECEIVED');

            // Iterate over each entry (there may be multiple if batched)
            for (const entry of body.entry) {
                // Iterate over each messaging event
                const webhookEvents = entry.messaging || [];

                for (const webhookEvent of webhookEvents) {
                    if (webhookEvent.message && webhookEvent.message.text) {
                        const senderId = webhookEvent.sender.id; // Who sent the DM (Lead)
                        const recipientId = webhookEvent.recipient.id; // Who received the DM (Our Connected Account)
                        const messageText = webhookEvent.message.text.toLowerCase();

                        console.log(`[Meta Webhook] Received DM from ${senderId} to ${recipientId}: ${messageText}`);

                        // 1. Find the Workspace handling this recipientId
                        const connectionsSnapshot = await db.collectionGroup('connections')
                            .where('accountId', '==', recipientId)
                            .get();

                        if (connectionsSnapshot.empty) {
                            console.log(`[Meta Webhook] No workspace found for connection accountId: ${recipientId}`);
                            continue;
                        }

                        // Assuming one workspace per account
                        const connectionDoc = connectionsSnapshot.docs[0];
                        const workspaceRef = connectionDoc.ref.parent.parent;
                        const workspaceId = workspaceRef.id;

                        // 2. Fetch Active Automations for the Workspace
                        const automationsSnapshot = await workspaceRef.collection('automations')
                            .where('status', '==', 'active')
                            .get();

                        const automations = [];
                        automationsSnapshot.forEach(doc => automations.push({ id: doc.id, ...doc.data() }));

                        // 3. Process DM Keyword Automations
                        for (const automation of automations) {
                            // Check if this automation targets specific connections
                            if (automation.connections && automation.connections.length > 0) {
                                if (!automation.connections.includes(connectionDoc.id)) {
                                    continue; // Skip, this automation doesn't apply to this connection
                                }
                            }

                            if (automation.trigger?.type === 'dm_keyword') {
                                const keywords = automation.trigger.config?.keywords || [];

                                // Check if any keyword matches
                                const isMatch = keywords.some(keyword => messageText.includes(keyword.toLowerCase()));

                                if (isMatch) {
                                    console.log(`[Meta Webhook] Automation Matched! (${automation.name})`);
                                    await processAutomationAction(workspaceId, automation, senderId, recipientId);
                                }
                            }
                        }
                    }
                }
            }
        } else {
            res.sendStatus(404);
        }
    } catch (error) {
        console.error('[Meta Webhook] Error processing webhook:', error);
        // We generally shouldn't return 500 otherwise Meta retries infinitely, 
        // returning 200 after logging the internal error is often safer.
    }
};

/**
 * Execute the action associated with an automation
 */
async function processAutomationAction(workspaceId, automation, senderId, recipientId) {
    const actionType = automation.action?.type;
    const config = automation.action?.config || {};

    // To do: Add actual limits and AI credits decrement here

    switch (actionType) {
        case 'send_dm':
            console.log(`[Automation] Action: Sending DM from ${recipientId} to ${senderId} - Message: ${config.message}`);
            // TODO: Integrate actual Meta Graph API call to send DM
            // await sendMetaDM(recipientId, senderId, config.message);
            break;

        case 'add_lead':
            console.log(`[Automation] Action: Adding Lead ${senderId} to CRM`);
            const db = getFirestore();
            await db.collection('workspaces').doc(workspaceId).collection('leads').add({
                externalId: senderId,
                platform: 'instagram', // or facebook
                status: 'new',
                acquiredAt: new Date().toISOString(),
                source: `Automation: ${automation.name}`
            });
            break;

        default:
            console.warn(`[Automation] Unsupported Action Type: ${actionType}`);
    }
}
