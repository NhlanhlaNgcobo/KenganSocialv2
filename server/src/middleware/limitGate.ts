import { Request, Response, NextFunction } from 'express';
import { db } from '../utils/firestore';
import { FieldValue } from 'firebase-admin/firestore';

// Plan thresholds (mock layout representing monthly limits)
export const PlanLimits: Record<string, Record<string, number>> = {
    starter: { posts: 10, exports: 5, aiCalls: 50, transcribeHrs: 0, clipAnalysis: 0, dmsDay: 0, storageGB: 1, renders: 0 },
    nano: { posts: 50, exports: 30, aiCalls: 500, transcribeHrs: 2, clipAnalysis: 5, dmsDay: 20, storageGB: 10, renders: 10 },
    creator: { posts: 200, exports: 100, aiCalls: 2000, transcribeHrs: 10, clipAnalysis: 20, dmsDay: 100, storageGB: 50, renders: 50 },
    agency: { posts: 9999, exports: 9999, aiCalls: 10000, transcribeHrs: 50, clipAnalysis: 100, dmsDay: 500, storageGB: 500, renders: 200 }
};

export function checkLimit(featureName: string) {
    return async (req: Request, res: Response, next: NextFunction) => {
        const workspaceId = (req as any).workspaceId;
        const plan = (req as any).plan || 'starter';

        const limit = PlanLimits[plan] ? PlanLimits[plan][featureName] : 0;

        if (limit === 0) {
            return res.status(403).json({ error: `Feature '${featureName}' requires an upgraded plan.` });
        }

        try {
            // Determine current billing cycle using current UTC 
            const d = new Date();
            const cycleKey = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`; // monthly generic isolation (Prod uses absolute Stripe timestamps)

            // Or daily check
            let trackingDocId = cycleKey;
            if (featureName === 'dmsDay') trackingDocId = `${cycleKey}-${d.getUTCDate()}`;

            const usageRef = db.collection('workspaces').doc(workspaceId).collection('usage').doc(trackingDocId);
            const doc = await usageRef.get();
            const currentUsage = doc.exists ? (doc.data()?.[featureName] || 0) : 0;

            if (currentUsage >= limit) {
                return res.status(402).json({
                    error: `Usage limit reached for ${featureName}. Please upgrade your plan.`,
                    limit,
                    currentUsage
                });
            }

            // Valid -> increment atomically
            await usageRef.set({
                [featureName]: FieldValue.increment(1)
            }, { merge: true });

            next();
        } catch (err) {
            console.error('Limit check error:', err);
            res.status(500).json({ error: 'Failed validating plan limits' });
        }
    }
}
