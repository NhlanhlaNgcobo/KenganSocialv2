import type { Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';
import { db } from '../utils/firestore';
import { applyDevPlanOverride } from '../utils/devPlan';

async function resolveWorkspaceForUser(uid: string, requestedWorkspaceId?: string) {
    if (requestedWorkspaceId) {
        const workspaceDoc = await db.collection('workspaces').doc(requestedWorkspaceId).get();
        if (!workspaceDoc.exists) {
            return null;
        }

        const workspaceData = workspaceDoc.data() as any;
        if (workspaceData.ownerId === uid) {
            return { id: workspaceDoc.id, plan: workspaceData.plan || 'starter' };
        }

        const memberDoc = await db
            .collection('workspaces')
            .doc(requestedWorkspaceId)
            .collection('members')
            .doc(uid)
            .get();

        if (!memberDoc.exists) {
            return null;
        }

        return { id: workspaceDoc.id, plan: workspaceData.plan || 'starter' };
    }

    const ownedWorkspace = await db
        .collection('workspaces')
        .where('ownerId', '==', uid)
        .limit(1)
        .get();

    if (!ownedWorkspace.empty) {
        const workspaceDoc = ownedWorkspace.docs[0];
        const workspaceData = workspaceDoc.data() as any;
        return { id: workspaceDoc.id, plan: workspaceData.plan || 'starter' };
    }

    const membershipQuery = await db
        .collectionGroup('members')
        .where(admin.firestore.FieldPath.documentId(), '==', uid)
        .limit(1)
        .get();

    if (membershipQuery.empty) {
        return null;
    }

    const workspaceRef = membershipQuery.docs[0].ref.parent.parent;
    if (!workspaceRef) {
        return null;
    }

    const workspaceDoc = await workspaceRef.get();
    if (!workspaceDoc.exists) {
        return null;
    }

    const workspaceData = workspaceDoc.data() as any;
    return { id: workspaceDoc.id, plan: workspaceData.plan || 'starter' };
}

export async function withWorkspace(req: Request, res: Response, next: NextFunction) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'MISSING_TOKEN' });
    }

    try {
        const decoded = await admin.auth().verifyIdToken(header.split('Bearer ')[1]);
        const uid = decoded.uid;
        const requestedWorkspaceId = (req.headers['x-workspace-id'] as string | undefined) || req.params.workspaceId;
        const resolvedWorkspace = await resolveWorkspaceForUser(uid, requestedWorkspaceId);

        (req as any).uid = uid;

        if (!resolvedWorkspace) {
            (req as any).workspaceId = null;
            (req as any).plan = 'starter';

            if (requestedWorkspaceId) {
                return res.status(403).json({ error: 'WORKSPACE_ACCESS_DENIED' });
            }

            return next();
        }

        (req as any).workspaceId = resolvedWorkspace.id;
        (req as any).plan = applyDevPlanOverride(resolvedWorkspace.plan);
        return next();
    } catch (err: any) {
        console.error('[withWorkspace] Token/workspace error:', err.message);
        return res.status(403).json({ error: 'INVALID_TOKEN' });
    }
}
