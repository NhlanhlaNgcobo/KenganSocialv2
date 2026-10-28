/**
 * Pilot invitations: one-time codes, a seat cap, and revocation (see config/pilot.ts).
 *
 * Firestore (server-only; firestore.rules deny clients):
 *  pilot_invites/{sha256(code)}  { note, email?, createdBy, createdAt, expiresAt, redeemedBy?, redeemedAt?, revokedAt? }
 *  pilot_members/{uid}           { email, inviteId, joinedAt, revokedAt? }
 *  pilot/state                   { members }   seats in use (revoked members free their seat)
 *
 * Codes are shown once when created; only their hash is stored. Redeeming is a transaction, so two
 * people redeeming at the same moment can't both take the last seat.
 */
import crypto from 'node:crypto';
import { pilotConfig } from '../config/pilot';

export type InviteError = 'INVITE_INVALID' | 'INVITE_USED' | 'INVITE_REVOKED' | 'INVITE_EXPIRED' | 'INVITE_EMAIL_MISMATCH' | 'PILOT_FULL' | 'MEMBER_REVOKED';
export class PilotInviteError extends Error {
    constructor(public code: InviteError, message: string) {
        super(message);
    }
}

const hash = (code: string) => crypto.createHash('sha256').update(code.trim()).digest('hex');
const INVITE_DAYS = 14;

export function newInviteCode() {
    // 12 characters, ~72 bits: not guessable, short enough to paste from a message.
    return crypto.randomBytes(9).toString('base64url');
}

/** The minimal Firestore surface used here (the Admin SDK's db, or a fake in tests). */
export interface Db {
    collection(name: string): any;
    doc(path: string): any;
    runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T>;
}

export async function createInvite(db: Db, { createdBy, note = '', email = '' }: { createdBy: string; note?: string; email?: string }) {
    const code = newInviteCode();
    const now = Date.now();
    const doc = {
        note: String(note).slice(0, 120),
        email: email ? String(email).trim().toLowerCase() : null,
        createdBy,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + INVITE_DAYS * 86400000).toISOString(),
        redeemedBy: null,
        redeemedAt: null,
        revokedAt: null,
    };
    const id = hash(code);
    await db.collection('pilot_invites').doc(id).set(doc);
    return { id, code, ...doc };
}

export async function revokeInvite(db: Db, id: string) {
    const ref = db.collection('pilot_invites').doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new PilotInviteError('INVITE_INVALID', 'Invite not found.');
    if (snap.data().redeemedBy) throw new PilotInviteError('INVITE_USED', 'This invite was already used; revoke the member instead.');
    await ref.update({ revokedAt: new Date().toISOString() });
}

/** Redeems `code` for this user. Idempotent: an existing member redeeming again is a no-op. */
export async function redeemInvite(db: Db, { uid, email, code }: { uid: string; email: string; code: string }) {
    const max = pilotConfig().maxUsers;
    const inviteRef = db.collection('pilot_invites').doc(hash(String(code || '')));
    const memberRef = db.collection('pilot_members').doc(uid);
    const stateRef = db.doc('pilot/state');
    const lowerEmail = String(email || '').toLowerCase();
    return db.runTransaction(async (tx) => {
        const [invite, member, state] = await Promise.all([tx.get(inviteRef), tx.get(memberRef), tx.get(stateRef)]);
        if (member.exists) {
            if (member.data().revokedAt) throw new PilotInviteError('MEMBER_REVOKED', 'Your beta access was ended. Contact the team if this is a mistake.');
            return { joined: false, alreadyMember: true };
        }
        if (!invite.exists) throw new PilotInviteError('INVITE_INVALID', "That invite code isn't valid.");
        const data = invite.data();
        if (data.revokedAt) throw new PilotInviteError('INVITE_REVOKED', 'That invite was withdrawn.');
        if (data.redeemedBy) throw new PilotInviteError('INVITE_USED', 'That invite has already been used.');
        if (Date.parse(data.expiresAt) < Date.now()) throw new PilotInviteError('INVITE_EXPIRED', 'That invite has expired. Ask for a new one.');
        if (data.email && data.email !== lowerEmail) throw new PilotInviteError('INVITE_EMAIL_MISMATCH', 'That invite is for a different email address.');
        const members = (state.exists ? Number(state.data().members) : 0) || 0;
        if (members >= max) throw new PilotInviteError('PILOT_FULL', 'The beta is full right now.');
        const now = new Date().toISOString();
        tx.update(inviteRef, { redeemedBy: uid, redeemedAt: now });
        tx.set(memberRef, { email: lowerEmail, inviteId: inviteRef.id, joinedAt: now, revokedAt: null });
        tx.set(stateRef, { members: members + 1 }, { merge: true });
        return { joined: true, alreadyMember: false };
    });
}

/** Ends a member's access and frees their seat. Their data is kept. */
export async function revokeMember(db: Db, uid: string) {
    const memberRef = db.collection('pilot_members').doc(uid);
    const stateRef = db.doc('pilot/state');
    return db.runTransaction(async (tx) => {
        const [member, state] = await Promise.all([tx.get(memberRef), tx.get(stateRef)]);
        if (!member.exists) throw new PilotInviteError('INVITE_INVALID', 'Member not found.');
        if (member.data().revokedAt) return { revoked: false };
        const members = (state.exists ? Number(state.data().members) : 0) || 0;
        tx.update(memberRef, { revokedAt: new Date().toISOString() });
        tx.set(stateRef, { members: Math.max(0, members - 1) }, { merge: true });
        return { revoked: true };
    });
}

export async function isActiveMember(db: Db, uid: string) {
    const snap = await db.collection('pilot_members').doc(uid).get();
    return snap.exists && !snap.data().revokedAt;
}
