import fs from 'node:fs';
import path from 'node:path';

/** Mounted deployment configuration; never expose or bundle tester addresses in the client. */
export function loadPilotEmails(file = path.resolve('config/pilot-access.json')) {
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(data.emails) || data.emails.length !== 5 ||
        data.emails.some(email => typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
        throw new Error('Pilot configuration must contain exactly five valid email addresses.');
    }
    const emails = new Set(data.emails.map(email => email.trim().toLowerCase()));
    if (emails.size !== 5) throw new Error('Pilot email addresses must be unique.');
    return emails;
}

export function createPilotAccess(emails, verifyToken) {
    return async (req, res, next) => {
        if (!emails) return next();
        const header = req.headers.authorization || '';
        if (!/^Bearer \S+$/.test(header)) return res.status(401).json({
            code: 'PILOT_SIGN_IN', error: 'This beta is invitation-only. Sign in with your invited Google account.'
        });
        let user;
        try { user = await verifyToken(header.slice(7), true); }
        catch { return res.status(401).json({ code: 'INVALID_TOKEN', error: 'Your sign-in could not be verified. Sign in again.' }); }
        if (!user.email_verified || !emails.has(String(user.email || '').toLowerCase())) {
            return res.status(403).json({ code: 'PILOT_ACCESS_DENIED', error: 'This beta is invitation-only. Use Google sign-in with one of the five invited accounts.' });
        }
        next();
    };
}
