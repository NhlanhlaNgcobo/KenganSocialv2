import fs from 'fs';
import axios from 'axios';
import admin from 'firebase-admin';
import { normalizeWords } from '../clips/transcript.js';
import { planEdit } from './planner.js';
import { enrichProfile, profileFromMetrics, sanitizeProfile } from './profile.js';

/**
 * AI Edit background jobs, run in this process one at a time (video analysis is CPU-heavy).
 * Progress lives in ai_edit_jobs/{id}; the client polls it.
 *
 *  style: reference video (link or upload) → measured, named editing style saved to the workspace
 *  edit:  editor upload + style → edit plan the editor applies to its timeline
 */

const PYTHON_URL = process.env.PYTHON_API_URL || 'http://localhost:8000';
const db = () => admin.firestore();
export const jobs = () => db().collection('ai_edit_jobs');
export const STALE_AFTER_MS = 30 * 60 * 1000;

let chain = Promise.resolve();
function enqueue(task) {
    const run = chain.then(task, task);
    chain = run.catch(() => {});
    return run;
}

const now = () => new Date().toISOString();

/** Keeps updatedAt fresh while a job waits or runs, so long footage is not mistaken for a lost job. */
function heartbeat(ref) {
    const timer = setInterval(() => ref.update({ updatedAt: now() }).catch(() => {}), 5 * 60 * 1000);
    return () => clearInterval(timer);
}

function pythonError(error, what) {
    if (error.code === 'ECONNREFUSED') return new Error('The video service is not running.');
    const detail = error.response?.data?.detail;
    const message = (typeof detail === 'object' ? detail?.message : detail) || error.response?.data?.error || error.message;
    return new Error(`${what} failed: ${message}`);
}

async function stage(ref, stageName, progress, extra = {}) {
    await ref.update({ stage: stageName, progress, updatedAt: now(), ...extra }).catch(() => {});
}

async function transcribe(videoPath, jobKey, workspaceId, plan) {
    const { data } = await axios.post(`${PYTHON_URL}/process/transcribe`, { videoUrl: videoPath, jobId: jobKey, workspaceId, plan }, { timeout: 2 * 60 * 60 * 1000 });
    return normalizeWords(data?.words || []);
}

/**
 * @param {FirebaseFirestore.DocumentReference} ref job document
 * @param {{ videoPath: string, removeAfter: boolean, source: object, workspaceId: string, uid: string, plan: string }} ctx
 */
export function runStyleJob(ref, ctx) {
    const stop = heartbeat(ref);
    return enqueue(async () => {
        const { videoPath, removeAfter, source, workspaceId, uid, plan } = ctx;
        try {
            await stage(ref, 'Measuring cuts, colour and captions', 15);
            const { data: metrics } = await axios
                .post(`${PYTHON_URL}/process/analyze-style`, { videoPath }, { timeout: 30 * 60 * 1000 })
                .catch((e) => {
                    throw pythonError(e, 'Style analysis');
                });

            await stage(ref, 'Listening to the pacing', 55);
            let words = [];
            try {
                words = await transcribe(videoPath, `aiedit_${ref.id}`, workspaceId, plan);
            } catch (error) {
                console.warn('[AI Edit] Reference transcription skipped:', error.message);
            }

            await stage(ref, 'Naming the style', 80);
            const measured = profileFromMetrics(metrics, words);
            const keyframes = metrics.keyframes || [];
            const opening = words.filter((w) => w.start < 12).map((w) => w.text).join(' ');
            const named = await enrichProfile(measured, { keyframes, transcript: opening, title: source.title || '' });
            const profile = sanitizeProfile({ ...named, source });

            const styleRef = db().collection('workspaces').doc(workspaceId).collection('edit_styles').doc();
            await styleRef.set({
                id: styleRef.id,
                ...profile,
                thumbnail: keyframes[1] || keyframes[0] || null,
                createdBy: uid,
                createdAt: now(),
            });
            await ref.update({ status: 'completed', stage: 'Done', progress: 100, styleId: styleRef.id, updatedAt: now() });
        } catch (error) {
            console.error(`[AI Edit] Style job ${ref.id} failed:`, error.message);
            await ref.update({ status: 'failed', stage: 'Failed', error: error.message, updatedAt: now() }).catch(() => {});
        } finally {
            stop();
            if (removeAfter) fs.rm(videoPath, { force: true }, () => {});
        }
    });
}

/**
 * @param {FirebaseFirestore.DocumentReference} ref job document
 * @param {{ videoPath: string, profile: object, options: object, workspaceId: string, plan: string }} ctx
 */
export function runEditJob(ref, ctx) {
    const stop = heartbeat(ref);
    return enqueue(async () => {
        const { videoPath, profile, options, workspaceId, plan } = ctx;
        try {
            await stage(ref, 'Transcribing your footage', 8);
            let words = [];
            try {
                words = await transcribe(videoPath, `aiedit_${ref.id}`, workspaceId, plan);
            } catch (error) {
                // Music-only or silent footage still gets framing, grade and titles.
                console.warn('[AI Edit] Footage transcription unavailable:', error.message);
            }

            await stage(ref, 'Finding faces and speakers', 45, { words: words.length });
            const { data: footage } = await axios
                .post(`${PYTHON_URL}/process/analyze-footage`, { videoPath }, { timeout: 60 * 60 * 1000 })
                .catch((e) => {
                    throw pythonError(e, 'Footage analysis');
                });

            await stage(ref, 'Editing: cuts, zooms, captions and titles', 75);
            const editPlan = await planEdit({ words, footage, profile, options });
            await ref.update({ status: 'completed', stage: 'Done', progress: 100, plan: editPlan, updatedAt: now() });
        } catch (error) {
            console.error(`[AI Edit] Edit job ${ref.id} failed:`, error.message);
            await ref.update({ status: 'failed', stage: 'Failed', error: error.message, updatedAt: now() }).catch(() => {});
        } finally {
            stop();
        }
    });
}
