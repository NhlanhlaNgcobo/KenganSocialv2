import fs from 'node:fs';
import path from 'node:path';

/** Mounted deployment configuration; never expose or bundle tester addresses in the client. */
// Up to 10 testers: the TikTok Sandbox app allows 10 target users.
export const MAX_PILOT_EMAILS = 10;

export function loadPilotEmails(file = path.resolve('config/pilot-access.json')) {
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(data.emails) || data.emails.length < 1 || data.emails.length > MAX_PILOT_EMAILS ||
        data.emails.some(email => typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
        throw new Error(`Pilot configuration must contain 1 to ${MAX_PILOT_EMAILS} valid email addresses.`);
    }
    const emails = new Set(data.emails.map(email => email.trim().toLowerCase()));
    if (emails.size !== data.emails.length) throw new Error('Pilot email addresses must be unique.');
    return emails;
}

/**
 * The pilot gate for /api. Two ways in, either is enough:
 *  - the legacy email list (config/pilot-access.json), and/or
 *  - PILOT_MODE=true invite membership (`member.isActive(uid)`, see services/pilot-invites.ts).
 * With neither configured the gate is off. `member.enabled()` is read per request so the switch
 * can be flipped without code changes.
 */
export function createPilotAccess(emails, verifyToken, member = null) {
    const cache = new Map(); // uid -> { ok, at }: membership checks are cached for a minute
    const CACHE_MS = 60_000;
    const memberOk = async (uid) => {
        const hit = cache.get(uid);
        if (hit && Date.now() - hit.at < CACHE_MS) return hit.ok;
        const ok = !!(await member.isActive(uid));
        cache.set(uid, { ok, at: Date.now() });
        if (cache.size > 5000) cache.delete(cache.keys().next().value);
        return ok;
    };
    const gate = async (req, res, next) => {
        const invites = !!member?.enabled();
        if (!emails && !invites) return next();
        const header = req.headers.authorization || '';
        if (!/^Bearer \S+$/.test(header)) return res.status(401).json({
            code: 'PILOT_SIGN_IN', error: 'This beta is invitation-only. Sign in with your invited account.'
        });
        let user;
        try { user = await verifyToken(header.slice(7), true); }
        catch { return res.status(401).json({ code: 'INVALID_TOKEN', error: 'Your sign-in could not be verified. Sign in again.' }); }
        if (!user.email_verified) {
            return res.status(403).json({ code: 'PILOT_EMAIL_UNVERIFIED', error: 'Verify your email address (or use Google sign-in) to join the beta.' });
        }
        if (emails?.has(String(user.email || '').toLowerCase())) return next();
        if (invites) {
            let ok = false;
            try { ok = await memberOk(user.uid); }
            catch { return res.status(503).json({ code: 'PILOT_CHECK_FAILED', error: "We couldn't check your beta access. Try again in a minute." }); }
            if (ok) return next();
            return res.status(403).json({ code: 'PILOT_INVITE_REQUIRED', error: 'This beta is invitation-only. Enter your invite code to join.' });
        }
        return res.status(403).json({ code: 'PILOT_ACCESS_DENIED', error: 'This beta is invitation-only. Use Google sign-in with the account you were invited with.' });
    };
    /** Forget a cached answer (after a redeem or revoke in this process). */
    gate.forget = (uid) => cache.delete(uid);
    return gate;
}
