import admin, { getAuth, getFirestore } from '../config/firebase.js';

/**
 * Get all workspaces for the authenticated user.
 */
export async function getWorkspaces(req, res) {
    try {
        const db = getFirestore();
        const uid = req.user.uid;

        const snapshot = await db.collection('workspaces')
            .where('ownerId', '==', uid)
            .get();

        const workspaces = [];
        snapshot.forEach(doc => {
            workspaces.push(doc.data());
        });

        // Sort client-side to avoid needing a composite index
        workspaces.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

        res.json({ workspaces });
    } catch (error) {
        console.error('[Workspace Controller] Get workspaces error:', error);
        res.status(500).json({ error: 'Failed to fetch workspaces' });
    }
}

/**
 * Create a new workspace.
 */
export async function createWorkspace(req, res) {
    try {
        const db = getFirestore();
        const uid = req.user.uid;
        const { name } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Workspace name is required' });
        }

        const now = new Date().toISOString();
        const workspaceRef = db.collection('workspaces').doc();

        const workspaceData = {
            id: workspaceRef.id,
            name,
            ownerId: uid,
            plan: 'free',
            createdAt: now,
            updatedAt: now,
        };

        await workspaceRef.set(workspaceData);

        // Add owner as a member
        await workspaceRef.collection('members').doc(uid).set({
            uid,
            role: 'owner',
            joinedAt: now,
        });

        res.status(201).json({ workspace: workspaceData });
    } catch (error) {
        console.error('[Workspace Controller] Create workspace error:', error);
        res.status(500).json({ error: 'Failed to create workspace' });
    }
}

/**
 * Resolves the caller's role in a workspace: 'owner', a member role, or null.
 */
async function getRole(db, workspaceId, uid) {
    const workspace = await db.collection('workspaces').doc(workspaceId).get();
    if (!workspace.exists) return { workspace: null, role: null };
    if (workspace.data().ownerId === uid) return { workspace, role: 'owner' };
    const member = await workspace.ref.collection('members').doc(uid).get();
    return { workspace, role: member.exists ? member.data().role || 'viewer' : null };
}

/**
 * Get a specific workspace by ID (members only).
 */
export async function getWorkspaceById(req, res) {
    try {
        const db = getFirestore();
        const { workspaceId } = req.params;

        const { workspace, role } = await getRole(db, workspaceId, req.user.uid);
        if (!workspace || !role) {
            return res.status(404).json({ error: 'Workspace not found' });
        }

        res.json({ workspace: workspace.data() });
    } catch (error) {
        console.error('[Workspace Controller] Get workspace error:', error);
        res.status(500).json({ error: 'Failed to fetch workspace' });
    }
}

// -------------------------------------------------------
// Team members
// -------------------------------------------------------

const MEMBER_ROLES = ['admin', 'editor', 'viewer'];

async function describeUser(db, uid) {
    const doc = await db.collection('users').doc(uid).get();
    const data = doc.exists ? doc.data() : {};
    let email = data.email || null;
    if (!email) {
        email = await getAuth().getUser(uid).then((u) => u.email).catch(() => null);
    }
    return { uid, name: data.displayName || email || 'Member', email, photoURL: data.photoURL || null };
}

/**
 * GET /api/workspaces/:workspaceId/members
 */
export async function getMembers(req, res) {
    try {
        const db = getFirestore();
        const { workspaceId } = req.params;
        const { workspace, role } = await getRole(db, workspaceId, req.user.uid);
        if (!workspace || !role) return res.status(404).json({ error: 'Workspace not found' });

        const ownerId = workspace.data().ownerId;
        const memberDocs = await workspace.ref.collection('members').get();
        const entries = [{ uid: ownerId, role: 'owner' }];
        memberDocs.forEach((doc) => {
            if (doc.id !== ownerId) entries.push({ uid: doc.id, role: doc.data().role || 'viewer', joinedAt: doc.data().joinedAt || null });
        });

        const members = await Promise.all(entries.map(async (e) => ({ ...(await describeUser(db, e.uid)), role: e.role, joinedAt: e.joinedAt || null })));
        res.json({ members, yourRole: role });
    } catch (error) {
        console.error('[Workspace Controller] Get members error:', error);
        res.status(500).json({ error: 'Failed to load team members' });
    }
}

/**
 * POST /api/workspaces/:workspaceId/members  { email, role }
 * Adds an existing KenganSocial user. Owner only.
 */
export async function addMember(req, res) {
    try {
        const db = getFirestore();
        const { workspaceId } = req.params;
        const email = String(req.body?.email || '').trim().toLowerCase();
        const role = MEMBER_ROLES.includes(req.body?.role) ? req.body.role : 'editor';

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });

        const { workspace, role: callerRole } = await getRole(db, workspaceId, req.user.uid);
        if (!workspace || !callerRole) return res.status(404).json({ error: 'Workspace not found' });
        if (callerRole !== 'owner') return res.status(403).json({ error: 'Only the workspace owner can add members.' });

        let invitee;
        try {
            invitee = await getAuth().getUserByEmail(email);
        } catch {
            return res.status(404).json({ error: 'No KenganSocial account uses that email. Ask them to sign up first, then add them here.' });
        }
        if (invitee.uid === workspace.data().ownerId) return res.status(400).json({ error: 'That is the workspace owner.' });

        const now = new Date().toISOString();
        await workspace.ref.collection('members').doc(invitee.uid).set({ uid: invitee.uid, role, joinedAt: now, addedBy: req.user.uid }, { merge: true });
        // Firestore security rules read the `members` array, so keep it in step.
        await workspace.ref.update({ members: admin.firestore.FieldValue.arrayUnion(invitee.uid), updatedAt: now });

        res.status(201).json({ member: { ...(await describeUser(db, invitee.uid)), role, joinedAt: now } });
    } catch (error) {
        console.error('[Workspace Controller] Add member error:', error);
        res.status(500).json({ error: 'Failed to add member' });
    }
}

/**
 * DELETE /api/workspaces/:workspaceId/members/:memberId — owner only.
 */
export async function removeMember(req, res) {
    try {
        const db = getFirestore();
        const { workspaceId, memberId } = req.params;
        const { workspace, role } = await getRole(db, workspaceId, req.user.uid);
        if (!workspace || !role) return res.status(404).json({ error: 'Workspace not found' });
        if (role !== 'owner') return res.status(403).json({ error: 'Only the workspace owner can remove members.' });
        if (memberId === workspace.data().ownerId) return res.status(400).json({ error: 'The owner cannot be removed.' });

        await workspace.ref.collection('members').doc(memberId).delete();
        await workspace.ref.update({ members: admin.firestore.FieldValue.arrayRemove(memberId), updatedAt: new Date().toISOString() });
        res.json({ success: true });
    } catch (error) {
        console.error('[Workspace Controller] Remove member error:', error);
        res.status(500).json({ error: 'Failed to remove member' });
    }
}
