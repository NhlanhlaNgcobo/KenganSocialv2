import { pilotConfig, pilotMode } from '../config/pilot';

/**
 * Pilot per-file upload cap (PILOT_MAX_UPLOAD_MB). Checks the declared size before any bytes are
 * stored: a resumable session's `size`, or a multipart request's Content-Length.
 */
export function pilotUploadCap(req, res, next) {
    if (!pilotMode()) return next();
    const maxBytes = pilotConfig().maxUploadMB * 1024 * 1024;
    const declared = req.is('application/json') ? Number(req.body?.size) : Number(req.get('content-length'));
    // Multipart adds a little framing around the file.
    const allowance = req.is('application/json') ? 0 : 1024 * 1024;
    if (Number.isFinite(declared) && declared > maxBytes + allowance) {
        return res.status(413).json({ code: 'PILOT_UPLOAD_TOO_LARGE', error: `During the beta, files are up to ${pilotConfig().maxUploadMB} MB.` });
    }
    next();
}
