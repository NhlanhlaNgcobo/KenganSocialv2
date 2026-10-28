import type { Request, Response, NextFunction } from 'express';
import { getAuth as firebaseAuth } from 'firebase-admin/auth';
import { db } from '../utils/firestore';
import { applyDevPlanOverride } from '../utils/devPlan';
import { effectivePlan, onBeta, trialEndsAt } from '../utils/trial';
import { noteBeta, noteTrial, noteUnlimited } from './planGate';
import { notePilotOverrides } from '../config/pilot';
import { enforceWorkspaceAccess, workspaceRole } from './workspaceAccess';

async function resolveWorkspaceForUser(uid: string, requestedWorkspaceId?: string) {
    if (requestedWorkspaceId) {
        const workspaceDoc = await db.collection('workspaces').doc(requestedWorkspaceId).get();
        if (!workspaceDoc.exists) {
            return null;
        }

        const workspaceData = workspaceDoc.data() as any;
        if (workspaceData.ownerId === uid) {
            return { id: workspaceDoc.id, plan: effectivePlan(workspaceData), trialEndsAt: trialEndsAt(workspaceData), beta: onBeta(workspaceData), unlimited: workspaceData.unlimited === true, role: 'owner' };
        }

        const memberDoc = await db
            .collection('workspaces')
            .doc(requestedWorkspaceId)
            .collection('members')
            .doc(uid)
            .get();

        if (!memberDoc.exists || !workspaceRole(memberDoc.data()?.role)) {
            return null;
        }

        return { id: workspaceDoc.id, plan: effectivePlan(workspaceData), trialEndsAt: trialEndsAt(workspaceData), beta: onBeta(workspaceData), unlimited: workspaceData.unlimited === true, role: memberDoc.data()!.role };
    }

    const ownedWorkspace = await db
        .collection('workspaces')
        .where('ownerId', '==', uid)
        .limit(1)
        .get();

    if (!ownedWorkspace.empty) {
        const workspaceDoc = ownedWorkspace.docs[0];
        const workspaceData = workspaceDoc.data() as any;
        return { id: workspaceDoc.id, plan: effectivePlan(workspaceData), trialEndsAt: trialEndsAt(workspaceData), beta: onBeta(workspaceData), unlimited: workspaceData.unlimited === true, role: 'owner' };
    }

    // Member of someone else's workspace: workspaces keep a `members` uid array (see workspace.controller.js).
    const memberOf = await db.collection('workspaces').where('members', 'array-contains', uid).limit(1).get();
    if (memberOf.empty) {
        return null;
    }

    // The array is only an index; the member document remains authoritative.
    return resolveWorkspaceForUser(uid, memberOf.docs[0].id);
}

export async function withWorkspace(req: Request, res: Response, next: NextFunction) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'MISSING_TOKEN' });
    }

    try {
        const decoded = await firebaseAuth().verifyIdToken(header.split('Bearer ')[1]);
        const uid = decoded.uid;
        const headerWorkspaceId = req.headers['x-workspace-id'];
        const urlWorkspaceId = req.params.workspaceId;
        if ((headerWorkspaceId !== undefined && typeof headerWorkspaceId !== 'string') ||
            (urlWorkspaceId !== undefined && typeof urlWorkspaceId !== 'string')) {
            return res.status(400).json({ error: 'INVALID_WORKSPACE_ID' });
        }
        // A request naming two different workspaces is refused rather than silently using one.
        if (headerWorkspaceId && urlWorkspaceId && headerWorkspaceId !== urlWorkspaceId) {
            return res.status(403).json({ error: 'WORKSPACE_MISMATCH' });
        }
        const requestedWorkspaceId = typeof urlWorkspaceId === 'string' ? urlWorkspaceId : typeof headerWorkspaceId === 'string' ? headerWorkspaceId : undefined;
        const resolvedWorkspace = await resolveWorkspaceForUser(uid, requestedWorkspaceId);

        (req as any).uid = uid;

        if (!resolvedWorkspace) {
            (req as any).workspaceId = null;
            (req as any).plan = 'starter';

            if (requestedWorkspaceId) {
                return res.status(403).json({ error: 'WORKSPACE_ACCESS_DENIED' });
            }

            return res.status(403).json({ error: 'WORKSPACE_REQUIRED' });
        }

        (req as any).workspaceId = resolvedWorkspace.id;
        (req as any).plan = applyDevPlanOverride(resolvedWorkspace.plan, resolvedWorkspace as any);
        // Trial quantities apply while the plan comes from the trial (not under a local plan override).
        noteTrial(resolvedWorkspace.id, (req as any).plan === resolvedWorkspace.plan ? resolvedWorkspace.trialEndsAt : null);
        noteUnlimited(resolvedWorkspace.id, !!(resolvedWorkspace as any).unlimited);
        noteBeta(resolvedWorkspace.id, (req as any).plan === resolvedWorkspace.plan && !!(resolvedWorkspace as any).beta);
        notePilotOverrides(resolvedWorkspace.id, (resolvedWorkspace as any).pilotLimits);
        (req as any).workspaceRole = resolvedWorkspace.role;
        return enforceWorkspaceAccess(req, res, next);
    } catch (err: any) {
        console.error('[withWorkspace] Token/workspace error:', err.message);
        return res.status(403).json({ error: 'INVALID_TOKEN' });
    }
}
