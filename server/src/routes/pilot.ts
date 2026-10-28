/**
 * Private pilot: invite redemption for testers, and admin tools (invites, members, overview).
 * Mounted at /api/pilot before the pilot gate (these routes check the token themselves).
 *
 * Admins carry the Firebase custom claim `pilotAdmin: true`, set with
 *   npx tsx scripts/pilot-admin.mjs grant <email>
 */
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import os from 'node:os';
import rateLimit from 'express-rate-limit';
import { pilotConfig, pilotMode } from '../config/pilot';
import { createInvite, isActiveMember, PilotInviteError, redeemInvite, revokeInvite, revokeMember, type Db } from '../services/pilot-invites';

type Verify = (token: string, checkRevoked: boolean) => Promise<{ uid: string; email?: string; email_verified?: boolean; pilotAdmin?: boolean }>;

interface Deps {
    db: Db;
    verifyToken: Verify;
    /** Called after a redeem/revoke so the gate's membership cache doesn't serve a stale answer. */
    forget?: (uid: string) => void;
    /** Ends a revoked member's sessions (Firebase revokeRefreshTokens). */
    revokeSessions?: (uid: string) => Promise<void>;
    /** Dashboard extras (usage counters, queues); optional so tests can skip Redis/BullMQ. */
    overviewExtras?: (members: { uid: string; email: string }[]) => Promise<Record<string, unknown>>;
}

const INVITE_STATUS: Record<string, number> = { INVITE_INVALID: 404, INVITE_USED: 409, INVITE_REVOKED: 410, INVITE_EXPIRED: 410, INVITE_EMAIL_MISMATCH: 403, PILOT_FULL: 409, MEMBER_REVOKED: 403 };

export function createPilotRouter(deps: Deps) {
    const router = express.Router();
    router.use(express.json({ limit: '10kb' }));

    const signedIn = async (req: Request, res: Response, next: NextFunction) => {
        const header = req.headers.authorization || '';
        if (!/^Bearer \S+$/.test(header)) return res.status(401).json({ code: 'SIGN_IN', error: 'Sign in first.' });
        try {
            (req as any).user = await deps.verifyToken(header.slice(7), true);
            next();
        } catch {
            res.status(401).json({ code: 'INVALID_TOKEN', error: 'Your sign-in could not be verified. Sign in again.' });
        }
    };
    const admin = (req: Request, res: Response, next: NextFunction) =>
        (req as any).user?.pilotAdmin === true ? next() : res.status(403).json({ code: 'ADMIN_ONLY', error: 'Pilot admins only.' });
    const fail = (res: Response, err: unknown) => {
        if (err instanceof PilotInviteError) return res.status(INVITE_STATUS[err.code] || 400).json({ code: err.code, error: err.message });
        console.error('[pilot]', (err as Error)?.message || err);
        return res.status(500).json({ code: 'PILOT_ERROR', error: 'Something went wrong. Try again.' });
    };

    router.get('/status', signedIn, async (req, res) => {
        const user = (req as any).user;
        if (!pilotMode()) return res.json({ pilot: false, member: true });
        try {
            res.json({ pilot: true, member: await isActiveMember(deps.db, user.uid), emailVerified: !!user.email_verified, admin: user.pilotAdmin === true });
        } catch (err) {
            fail(res, err);
        }
    });

    // Guessing codes: 10 tries per 15 minutes per account (and per IP for unauthenticated noise).
    const redeemLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, keyGenerator: (req: any) => req.user?.uid || req.ip, message: { code: 'TOO_MANY_TRIES', error: 'Too many tries. Wait 15 minutes.' } });
    router.post('/redeem', signedIn, redeemLimit, async (req, res) => {
        const user = (req as any).user;
        if (!pilotMode()) return res.json({ joined: false, alreadyMember: true });
        if (!user.email_verified) return res.status(403).json({ code: 'PILOT_EMAIL_UNVERIFIED', error: 'Verify your email address (or use Google sign-in) first.' });
        const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
        if (!/^[A-Za-z0-9_-]{8,64}$/.test(code)) return res.status(400).json({ code: 'INVITE_INVALID', error: "That invite code isn't valid." });
        try {
            const result = await redeemInvite(deps.db, { uid: user.uid, email: user.email || '', code });
            deps.forget?.(user.uid);
            res.json(result);
        } catch (err) {
            fail(res, err);
        }
    });

    // ── Admin ──
    router.post('/admin/invites', signedIn, admin, async (req, res) => {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ code: 'BAD_EMAIL', error: 'Enter a valid email or leave it empty.' });
        try {
            const invite = await createInvite(deps.db, { createdBy: (req as any).user.uid, note: req.body?.note, email });
            res.status(201).json(invite); // the code is returned once and never stored
        } catch (err) {
            fail(res, err);
        }
    });
    router.get('/admin/invites', signedIn, admin, async (_req, res) => {
        try {
            const snap = await deps.db.collection('pilot_invites').orderBy('createdAt', 'desc').limit(200).get();
            const now = Date.now();
            const status = (i: any) => (i.redeemedBy ? 'used' : i.revokedAt ? 'withdrawn' : Date.parse(i.expiresAt) < now ? 'expired' : 'open');
            res.json({ invites: snap.docs.map((d: any) => ({ id: d.id, ...d.data(), status: status(d.data()) })) });
        } catch (err) {
            fail(res, err);
        }
    });
    router.post('/admin/invites/:id/revoke', signedIn, admin, async (req, res) => {
        if (!/^[a-f0-9]{64}$/.test(req.params.id)) return res.status(400).json({ code: 'INVITE_INVALID', error: 'Bad invite id.' });
        try {
            await revokeInvite(deps.db, req.params.id);
            res.json({ ok: true });
        } catch (err) {
            fail(res, err);
        }
    });
    router.post('/admin/members/:uid/revoke', signedIn, admin, async (req, res) => {
        const uid = req.params.uid;
        if (!/^[A-Za-z0-9]{1,128}$/.test(uid)) return res.status(400).json({ code: 'BAD_UID', error: 'Bad user id.' });
        try {
            const result = await revokeMember(deps.db, uid);
            deps.forget?.(uid);
            await deps.revokeSessions?.(uid).catch(() => {});
            res.json(result);
        } catch (err) {
            fail(res, err);
        }
    });

    router.get('/admin/overview', signedIn, admin, async (_req, res) => {
        try {
            const [membersSnap, state] = await Promise.all([deps.db.collection('pilot_members').get(), deps.db.doc('pilot/state').get()]);
            const members = membersSnap.docs.map((d: any) => ({ uid: d.id, ...d.data() }));
            const active = members.filter((m: any) => !m.revokedAt);
            const extras = deps.overviewExtras ? await deps.overviewExtras(active).catch((e) => ({ extrasError: String(e?.message || e) })) : {};
            const mem = process.memoryUsage();
            res.json({
                pilot: pilotMode(),
                config: pilotConfig(),
                seats: { used: (state.exists && Number(state.data().members)) || 0, max: pilotConfig().maxUsers },
                members,
                server: {
                    loadavg: os.loadavg(),
                    cpus: os.cpus().length,
                    memTotalMB: Math.round(os.totalmem() / 1048576),
                    memFreeMB: Math.round(os.freemem() / 1048576),
                    processRssMB: Math.round(mem.rss / 1048576),
                    uptimeS: Math.round(process.uptime()),
                },
                ...extras,
            });
        } catch (err) {
            fail(res, err);
        }
    });

    return router;
}
