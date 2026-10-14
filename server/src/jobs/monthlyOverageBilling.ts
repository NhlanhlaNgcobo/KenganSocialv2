import cron from 'node-cron';

// Simulated imports for external dependencies
import { redis } from '../utils/redis'; // Adjust path as necessary
import { stripe } from '../utils/stripe'; // Adjust path as necessary
import { db } from '../utils/firestore'; // Adjust path as necessary
import { getMonth } from '../utils/dateUtils'; // Adjust path as necessary

export const CAP_RATES = {
    clipAnalysis: { cap: 50, rate: 5 }, // R5 per video
    transcribeHrs: { cap: 50, rate: 19.90 }, // R19.90 per hour
    storageGB: { cap: 50, rate: 0.75 }, // R0.75 per GB
    renders: { cap: 500, rate: 2.50 } // R2.50 per render
};

export async function processWorkspaceOverage(workspaceId: string, customerId: string) {
    const month = getMonth(); // format: YYYY-MM
    const usageKeys = {
        clipAnalysis: `agency_usage:${workspaceId}:clipAnalysis:${month}`,
        transcribeHrs: `agency_usage:${workspaceId}:transcribeHrs:${month}`,
        storageGB: `agency_usage:${workspaceId}:storageGB:${month}`,
        renders: `agency_usage:${workspaceId}:renders:${month}`
    };

    const overages = [];
    let totalOverageAmount = 0;

    for (const [feature, key] of Object.entries(usageKeys)) {
        const val = await redis.get(key);
        const count = val ? parseFloat(val) : 0;
        const { cap, rate } = CAP_RATES[feature as keyof typeof CAP_RATES];

        if (count > cap) {
            const excess = count - cap;
            const amount = excess * rate;
            overages.push({ feature, excess, amount });
            totalOverageAmount += amount;

            if (amount > 0) {
                // Create an invoice item in Stripe for each overage
                await stripe.invoiceItems.create({
                    customer: customerId,
                    amount: Math.round(amount * 100), // Convert to cents for Stripe
                    currency: 'zar',
                    description: `Overage for ${feature}: ${excess.toFixed(2)} units over cap`
                });
            }
        }
    }

    // If there's an overage, log it to Firestore
    if (overages.length > 0) {
        const docPath = `overageInvoices/${workspaceId}/${month}`;
        await db.doc(docPath).set({
            workspaceId,
            customerId,
            month,
            overages,
            totalAmount: totalOverageAmount,
            billedAt: new Date().toISOString()
        });
    }
}

// Cron job that runs every day at midnight to process workspaces falling on their anniversary date
export function startOverageBillingJob() {
    cron.schedule('0 0 * * *', async () => {
        try {
            console.log('Running monthly overage billing job...');
            // Note: Implement logical fetch for `workspaces` whose billing anniversary is today.
            // const workspaces = await getWorkspacesBillingToday();
            // for (const ws of workspaces) {
            //   await processWorkspaceOverage(ws.id, ws.stripeCustomerId);
            // }
        } catch (error) {
            console.error('Error during monthly overage billing job:', error);
        }
    });
}
