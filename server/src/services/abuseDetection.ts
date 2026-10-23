import cron from 'node-cron';

// Simulated imports for external dependencies
import { redis } from '../utils/redis';
import { db } from '../utils/firestore';
// No external alert transport is configured. These events go to the deployment log sink.
async function logAbuseAlert(message: string) { console.error('[Abuse alert]', message); }

/**
 * Initiates hourly and 6-hourly cron jobs for abuse detection and API budgets.
 */
export function startAbuseDetectionJobs() {
    // 1. Usage anomaly check (hourly cron)
    cron.schedule('0 * * * *', async () => {
        await checkUsageAnomalies();
    });

    // 2. API budget guard (every 6 hours)
    cron.schedule('0 */6 * * *', async () => {
        await checkApiBudgets();
    });
}

async function checkUsageAnomalies() {
    try {
        // Note: Logical stubs to fetch active workspaces.
        // If workspace uses >3x plan average in 24hrs: alert + Slack ping
        // Example: await logAbuseAlert('Workspace {{id}} is using >3x their plan average limit.');

        // If agency clip analysis >40 videos in 24hrs: warn email to workspace owner
        // Example: await sendEmail(ownerEmail, 'Warning: >40 videos processed in 24 hours');
    } catch (err) {
        console.error('Anomaly Check Error:', err);
    }
}

async function checkApiBudgets() {
    try {
        // Fetch projected API spends
        const gcpSpend = await calculateProjectedGCPSpend();
        const assemblyAISpend = await calculateProjectedAssemblyAISpend();

        // If GCP projected monthly spend >$1,200: alert founder
        if (gcpSpend > 1200) {
            await logAbuseAlert(`🚨 GCP projected monthly spend exceeded $1,200 (${gcpSpend})`);
        }

        // If AssemblyAI projected spend >$800: switch to batch mode (slower, cheaper)
        if (assemblyAISpend > 800) {
            await db.collection('settings').doc('system').set({ assemblyAIMode: 'batch' }, { merge: true });
            await logAbuseAlert(`⚠️ AssemblyAI switched to batch mode due to budget cap (${assemblyAISpend})`);
        }
    } catch (err) {
        console.error('Budget Check Error:', err);
    }
}

/**
 * 3. DM spam detection (per DM batch send)
 */
export async function checkDMSpam(workspaceId: string, messageContent: string, recipientCount: number) {
    // Identical message to >10 recipients in 1 hour: 24hr DM lock on workspace
    const hash = Buffer.from(messageContent).toString('base64');
    const key = `dm_spam:${workspaceId}:${hash}`;
    const sentCount = await redis.incrby(key, recipientCount);
    if (sentCount === recipientCount) {
        await redis.expire(key, 3600); // 1 hour window
    }

    if (sentCount > 10) {
        await db.collection('workspaces').doc(workspaceId).set({ dmLockedUntil: Date.now() + 86400000 }, { merge: true });
        await logAbuseAlert(`🛑 Workspace ${workspaceId} locked for 24h due to DM spam`);
        throw new Error('SPAM_DETECTED: DM capabilities locked for 24 hours.');
    }

    // Any opt-out word (STOP, UNSUBSCRIBE, REMOVE): add to permanent suppression list
    const lowerMessage = messageContent.toLowerCase();
    if (lowerMessage.includes('stop') || lowerMessage.includes('unsubscribe') || lowerMessage.includes('remove')) {
        // Note: Here we would add specific recipients to the suppression list
    }
}

const WHITELISTED_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'jpg', 'jpeg', 'png', 'gif'];

/**
 * 4. File upload abuse checks
 */
export async function validateFileUpload(
    workspaceId: string,
    fileInfo: { extension: string, sizeBytes: number, md5Hash: string },
    workspaceStorageLimitGB: number
) {
    // Whitelist: only mp4,mov,avi,mkv,webm,jpg,jpeg,png,gif accepted
    if (!WHITELISTED_EXTENSIONS.includes(fileInfo.extension.toLowerCase())) {
        throw new Error('INVALID_FILE_TYPE: Only video and image formats are allowed');
    }

    // MD5 hash check: reject duplicates within same workspace within 24hrs
    const duplicateKey = `file_hash:${workspaceId}:${fileInfo.md5Hash}`;
    const duplicateExists = await redis.get(duplicateKey);
    if (duplicateExists) {
        throw new Error('DUPLICATE_FILE: Exact file uploaded in the last 24 hours');
    }
    await redis.set(duplicateKey, '1', 'EX', 86400);

    // Pre-upload size check vs workspace storage quota
    const month = new Date().toISOString().slice(0, 7);
    const storageUsedKey = `usage:${workspaceId}:storageGB:${month}`;
    const currentStorageGB = parseFloat(await redis.get(storageUsedKey) || '0');
    const incomingSizeGB = fileInfo.sizeBytes / (1024 * 1024 * 1024);

    // Storage limit check (skipping if agency usage checks elsewhere apply, assuming standard rigid guard here)
    if (workspaceStorageLimitGB !== -1 && (currentStorageGB + incomingSizeGB) > workspaceStorageLimitGB) {
        throw new Error('QUOTA_EXCEEDED: Workspace storage capacity met');
    }
}

/**
 * 5. Duplicate account detection (on signup)
 */
export async function detectDuplicateAccounts(domain: string, stripeFingerprint: string) {
    const commonDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com'];

    // Same email domain with >3 accounts: flag for manual review
    if (domain && !commonDomains.includes(domain)) {
        const domainKey = `signup_domain:${domain}`;
        const domainCount = await redis.incr(domainKey);
        // Don't expire the key to enforce total lifetime domains, or apply expiration as business requires
        if (domainCount > 3) {
            await logAbuseAlert(`🔍 Domain ${domain} flagged for manual review (Account #${domainCount})`);
        }
    }

    // Same Stripe card fingerprint with >3 workspaces: require approval
    if (stripeFingerprint) {
        const cardKey = `signup_card:${stripeFingerprint}`;
        const cardCount = await redis.incr(cardKey);
        if (cardCount > 3) {
            throw new Error('RISK_FLAG: Payment method is associated with too many workspaces. Contact support.');
        }
    }
}

// ----- Simulated stub functions for projections -----
async function calculateProjectedGCPSpend() { return 500; }
async function calculateProjectedAssemblyAISpend() { return 300; }
