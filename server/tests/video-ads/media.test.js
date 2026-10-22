import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FFMPEG } from '../../src/services/ffmpeg-runner.js';
import { finalizeExport, verifyExport } from '../../src/services/video-ads/media.js';

test('actual MP4 exports enforce the ceiling and retain audio/video after remuxing', async () => {
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kengan-ad-media-test-'));
    try {
        const original=path.join(dir,'padded.mp4');
        await promisify(execFile)(FFMPEG,['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=black:s=32x32:r=30:d=26','-f','lavfi','-i','sine=frequency=400:duration=26','-c:v','libx264','-g','30','-c:a','aac','-shortest',original],{windowsHide:true,timeout:60000});
        await assert.rejects(verifyExport(original,25),/did not pass/);
        for(const duration of [15,20,25]) {
            const actual=await finalizeExport(original,path.join(dir,`${duration}.mp4`),duration);
            assert.ok(actual<=duration+0.001);
            assert.ok(actual>=duration-.1);
        }
    } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
