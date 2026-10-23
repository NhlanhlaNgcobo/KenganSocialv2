import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Deletes old working files so a long-running server's disk doesn't fill up: renders, upload
 * sources and job folders in <tmp>/kengan-renders, multer's unfinished uploads (32 hex
 * characters) in <tmp>, and the video service's kengan-* working files (it shares <tmp> on the
 * VM). Files newer than TEMP_RETENTION_HOURS (default 72) are kept, so exports stay downloadable
 * and editor uploads usable for three days.
 */
const RENDER_DIR = path.join(os.tmpdir(), 'kengan-renders');
// Folders swept item by item (each upload session / registry entry ages on its own), never removed whole.
const ITEM_DIRS = ['kengan-renders', 'kengan-resumable', 'kengan-upload-registry'];
const MULTER_NAME = /^[0-9a-f]{32}$/;

function retentionMs() {
    const hours = Number(process.env.TEMP_RETENTION_HOURS);
    return (Number.isFinite(hours) && hours > 0 ? hours : 72) * 3600 * 1000;
}

function removeIfOld(entry, cutoff) {
    try {
        const stat = fs.statSync(entry);
        if (stat.mtimeMs >= cutoff) return 0;
        fs.rmSync(entry, { recursive: true, force: true });
        return 1;
    } catch {
        return 0;
    }
}

export function sweepTempFiles() {
    const cutoff = Date.now() - retentionMs();
    let removed = 0;
    for (const dir of ITEM_DIRS) {
        const full = path.join(os.tmpdir(), dir);
        if (!fs.existsSync(full)) continue;
        for (const name of fs.readdirSync(full)) removed += removeIfOld(path.join(full, name), cutoff);
    }
    for (const name of fs.readdirSync(os.tmpdir())) {
        if (MULTER_NAME.test(name) || (name.startsWith('kengan-') && !ITEM_DIRS.includes(name))) removed += removeIfOld(path.join(os.tmpdir(), name), cutoff);
    }
    if (removed) console.log(`[temp-sweeper] removed ${removed} old working files`);
    return removed;
}

/** Sweeps once an hour (and once shortly after start). */
export function startTempSweeper() {
    setTimeout(sweepTempFiles, 60 * 1000).unref();
    setInterval(sweepTempFiles, 3600 * 1000).unref();
}
