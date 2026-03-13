import Stripe from 'stripe';
import { getFirestore } from '../config/firebase.js';

let stripeClient = null;

function getStripe() {
    if (!stripeClient && process.env.STRIPE_SECRET_KEY) {
        stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
    }
    return stripeClient;
}

// -------------------------------------------------------
// Plan Definitions
// -------------------------------------------------------

const PLANS = {
    creator_starter: {
        name: 'Creator Starter',
        priceZAR: 249,
        credits: 1000,
        maxConnections: 4,
        features: [
            '1 account per platform (max 4)',
            '1,000 AI credits/month',
            '3 automation rules',
            'Basic analytics',
            'Standard processing speed'
        ],
    },
    creator_pro: {
        name: 'Creator Pro',
        priceZAR: 499,
        credits: 5000,
        maxConnections: 12,
        features: [
            'Up to 3 accounts per platform (max 12)',
            '5,000 AI credits/month',
            'Unlimited automation rules',
            'Priority processing',
            'Advanced analytics'
        ],
    },
    agency: {
        name: 'Agency Plan',
        priceZAR: 3199,
        credits: 20000,
        maxConnections: 40,
        features: [
            'Up to 10 accounts per platform (max 40)',
            '20,000 AI credits/month',
            'Team access (3 seats)',
            'Faster compute queue'
        ],
    },
    enterprise: {
        name: 'Enterprise',
        priceZAR: 0,
        credits: 50000,
        maxConnections: 100,
        features: [
            '30+ accounts per platform',
            '50,000+ AI credits',
            'White label',
            'Dedicated compute',
            'SLA support',
            '5+ team members',
            'Custom integrations'
        ],
    },
};

/**
 * GET /api/billing/plans
 * Return available subscription plans.
 */
export async function getPlans(req, res) {
    res.json({ plans: PLANS });
}

/**
 * GET /api/billing/:workspaceId
 * Get billing info for a workspace.
 */
export async function getBillingInfo(req, res) {
    try {
        const db = getFirestore();
        const { workspaceId } = req.params;

        const doc = await db.collection('workspaces').doc(workspaceId).get();
        if (!doc.exists) {
            return res.status(404).json({ error: 'Workspace not found' });
        }

        const data = doc.data();
        const plan = data.plan || 'free';
        const planDetails = PLANS[plan] || { name: 'Free', priceZAR: 0, credits: 50, videoCredits: 0, maxConnections: 3 };

        res.json({
            plan,
            planDetails,
            credits: data.credits !== undefined ? data.credits : 50,
            stripeCustomerId: data.stripeCustomerId || null,
            stripeSubscriptionId: data.stripeSubscriptionId || null,
        });
    } catch (error) {
        console.error('[Billing Controller] Get billing error:', error);
        res.status(500).json({ error: 'Failed to fetch billing info' });
    }
}

/**
 * POST /api/billing/checkout
 * Create a Stripe Checkout session for plan upgrade.
 */
export async function createCheckoutSession(req, res) {
    try {
        const stripe = getStripe();
        if (!stripe) {
            return res.status(503).json({ error: 'Stripe is not configured' });
        }

        const db = getFirestore();
        const { workspaceId, planId } = req.body;
        const uid = req.user.uid;

        if (!workspaceId || !planId) {
            return res.status(400).json({ error: 'Workspace ID and Plan ID are required' });
        }

        const plan = PLANS[planId];
        if (!plan) {
            return res.status(400).json({ error: 'Invalid plan ID' });
        }

        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'zar',
                    product_data: {
                        name: `KenganSocial ${plan.name} Plan`,
                        description: plan.features.join(', '),
                    },
                    unit_amount: plan.priceZAR * 100, // in cents
                    recurring: { interval: 'month' },
                },
                quantity: 1,
            }],
            success_url: `${process.env.CLIENT_URL}/dashboard/billing?success=true`,
            cancel_url: `${process.env.CLIENT_URL}/dashboard/billing?canceled=true`,
            metadata: {
                workspaceId,
                userId: uid,
                planId,
            },
        });

        res.json({ url: session.url, sessionId: session.id });
    } catch (error) {
        console.error('[Billing Controller] Checkout error:', error);
        res.status(500).json({ error: 'Failed to create checkout session' });
    }
}

/**
 * POST /api/billing/webhook
 * Handle Stripe webhook events (subscription created, updated, cancelled).
 */
export async function handleWebhook(req, res) {
    try {
        const stripe = getStripe();
        if (!stripe) {
            return res.status(503).json({ error: 'Stripe is not configured' });
        }

        const sig = req.headers['stripe-signature'];
        let event;

        try {
            event = stripe.webhooks.constructEvent(
                req.body,
                sig,
                process.env.STRIPE_WEBHOOK_SECRET
            );
        } catch (err) {
            console.error('[Billing] Webhook signature verification failed:', err.message);
            return res.status(400).json({ error: 'Webhook signature verification failed' });
        }

        const db = getFirestore();

        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object;
                const { workspaceId, planId } = session.metadata;

                const plan = PLANS[planId];
                if (plan && workspaceId) {
                    await db.collection('workspaces').doc(workspaceId).update({
                        plan: planId,
                        credits: plan.credits,
                        stripeCustomerId: session.customer,
                        stripeSubscriptionId: session.subscription,
                        updatedAt: new Date().toISOString(),
                    });
                }
                break;
            }

            case 'customer.subscription.deleted': {
                const subscription = event.data.object;
                // Find workspace by subscription ID and downgrade
                const snapshot = await db.collection('workspaces')
                    .where('stripeSubscriptionId', '==', subscription.id)
                    .get();

                snapshot.forEach(async (doc) => {
                    await doc.ref.update({
                        plan: 'free',
                        credits: 50,
                        videoCredits: 0,
                        stripeSubscriptionId: null,
                        updatedAt: new Date().toISOString(),
                    });
                });
                break;
            }
        }

        res.json({ received: true });
    } catch (error) {
        console.error('[Billing Controller] Webhook error:', error);
        res.status(500).json({ error: 'Webhook handler failed' });
    }
}
