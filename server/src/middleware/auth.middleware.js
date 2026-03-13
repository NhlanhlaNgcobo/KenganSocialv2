import { getAuth } from '../config/firebase.js';

/**
 * Verifies Firebase ID token from Authorization header.
 * Attaches decoded user to req.user.
 */
export async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid authorization token' });
    }

    const token = authHeader.split('Bearer ')[1];

    try {
        const decodedToken = await getAuth().verifyIdToken(token);
        req.user = decodedToken;
        next();
    } catch (error) {
        console.error('[Auth Middleware] Token verification failed:', error.message);
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

/**
 * Checks if the authenticated user has one of the required roles
 * in the current workspace.
 */
export function requireRole(...allowedRoles) {
    return async (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const workspaceId = req.headers['x-workspace-id'] || req.params.workspaceId;

        if (!workspaceId) {
            return res.status(400).json({ error: 'Workspace ID required' });
        }

        try {
            const { getFirestore } = await import('../config/firebase.js');
            const db = getFirestore();

            const memberDoc = await db
                .collection('workspaces')
                .doc(workspaceId)
                .collection('members')
                .doc(req.user.uid)
                .get();

            if (memberDoc.exists) {
                const memberData = memberDoc.data();
                if (!allowedRoles.includes(memberData.role)) {
                    return res.status(403).json({ error: 'Insufficient permissions' });
                }
                req.workspace = { id: workspaceId, role: memberData.role };
                return next();
            }

            // Fallback: check if user is the workspace owner
            const workspaceDoc = await db.collection('workspaces').doc(workspaceId).get();
            if (workspaceDoc.exists && workspaceDoc.data().ownerId === req.user.uid) {
                req.workspace = { id: workspaceId, role: 'owner' };
                return next();
            }

            return res.status(403).json({ error: 'Not a member of this workspace' });
        } catch (error) {
            console.error('[Auth Middleware] Role check failed:', error.message);
            return res.status(500).json({ error: 'Authorization check failed' });
        }
    };
}
