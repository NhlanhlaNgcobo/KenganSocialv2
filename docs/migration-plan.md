# Preview & video infrastructure migration plan

2026-10-28 · Branch `perf/browser-preview`. Every step is behind a flag with a one-step rollback. Steps marked **Needs approval** touch production infrastructure, storage or credentials and are **not** started until approved.

## Ranked fixes

| # | Fix | Impact | Cost | Risk | Status |
|---|---|---|---|---|---|
| 1 | Decouple preview/timeline renders from the playback clock (preview engine v2) | Medium: removes ~99 % of per-frame renders; fps gain not measurable on the 6-core test machine, expected on slower devices | 0 | Low (flag, legacy kept) | **Done on branch**; edit latency ~6 ms worse to investigate before default-on |
| 2 | Seek coalescing in `MediaLayer` | Medium: scrub p95 278 → 214 ms | 0 | Low (v2 only) | **Done on branch** |
| 3 | Selector reads in `PreviewPanel`, `MediaLayer` memo | Medium | 0 | Low | **Done on branch** |
| 4 | Throttle trim/slider/text writes to one per frame; memo `TimelineToolbar` | Medium (edit latency) | 0 | Low | Next |
| 5 | Colour panel: rebuild LUT off the input path (debounce / worker) | Medium while grading | 0 | Low | Next |
| 6 | Waveform decoding in a Web Worker | Medium on import | 0 | Low | Next |
| 7 | Timeline virtualisation (render only visible elements) | High for long projects (> 100 elements) | 0 | Medium | After 4–6, if long-project bench still janky |
| 8 | Export timeout, cancel, global concurrency cap | High (server stability) | 0 | Low | Ready to implement; deploy **Needs approval** |
| 9 | HTTP Range on export download | Low | 0 | Low | Ready to implement |
| 10 | Preview proxies (540p, short GOP) for long-GOP phone/4K footage | **Likely the biggest real-world win** for seek latency on phone footage (to confirm with real files) | CPU per upload | Medium | Phase 3, flag `PROXY_PREVIEW`; **Needs approval** to run on the VPS |
| 11 | Async exports in a BullMQ worker container (non-root) | High (API isolation) | 0 (same VPS) | Medium | Phase 5, flag `EXPORT_QUEUE`; **Needs approval** |
| 12 | Cloudflare R2 for originals/proxies/exports with signed URLs (server-side keys only) | Medium (durability, zero egress) | ≈ $7/month, see `cost-model.md` | Medium | Phase 4; **Needs approval** + you create buckets and keys |
| — | WebCodecs/WebAV preview rewrite | Not justified by data: `<video>` decode held ~25 fps at 4K under ×4 throttle | High effort | High | Re-evaluate only if v2 + proxies miss targets |
| — | ffmpeg.wasm, GPU hosts | Not needed | — | — | Rejected |

## Phase plan

### Phase 2 — preview engine v2 (this branch)
0. Before default-on: explain/fix the per-edit regression, re-run the long-project scenario ≥ 5 times, and bench with real phone footage and a low-end device.
1. Ship with `VITE_PREVIEW_ENGINE` unset (legacy). Testers opt in with `?preview=v2`.
2. After a week without regressions, set `VITE_PREVIEW_ENGINE=v2` on Vercel and redeploy.
3. Rollback: `?preview=legacy` (one browser) or unset the variable and redeploy (everyone).
4. Remove legacy code paths only after v2 has been the default for one release.

### Phase 3 — proxies (**Needs approval**)
- On upload of video ≥ 1080p or GOP > 2 s: FFmpeg `-vf scale=-2:540 -g 15 -preset veryfast -crf 28`, stored next to the original.
- Editor uses the proxy for preview, the original for export. Flag `PROXY_PREVIEW`, default off.
- Measure CPU-seconds per source second before enabling for all.

### Phase 4 — R2 (**Needs approval**; you supply credentials via `.env`, never in chat)
- Buckets `kengan-originals`, `kengan-proxies`, `kengan-exports`; lifecycle: originals/exports 30 days.
- Server issues short-lived presigned PUT/GET URLs; no R2 keys in the browser.
- New env names (to add to `.env.example` only when approved): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_ORIGINALS`, `R2_BUCKET_PROXIES`, `R2_BUCKET_EXPORTS`. Flag `STORAGE_DRIVER=local|r2`, default `local`.
- No existing media is moved or deleted; new uploads only.

### Phase 5 — async exports (**Needs approval**)
- `POST /export` enqueues a BullMQ job (`exports` queue) and returns a job id; client polls / SSE for progress.
- Separate `export-worker` container: `user: node`, concurrency 1 (configurable), job timeout = 4 × output duration + 2 min, cancel via job removal + FFmpeg kill.
- Flag `EXPORT_QUEUE=off|on`; `off` keeps the current in-process path.

### Phase 6 — containers (**Needs approval** before touching the VPS)
- Add `user:` to all app containers; fix CPU caps so they sum ≤ 2 vCPU with n8n headroom.
- Redis stays unpublished; no DB ports exposed.
- Deploy to a staging compose project first, never over `kengansocial-beta` without sign-off.

### Phase 7–8 — acceptance & delivery
- Bench (`scripts/bench-editor.mjs`) gates each phase: v2 must beat legacy on presented fps, long-task ms and seek p95 at ×4 CPU throttle.
- Export tests: timeout, cancel, concurrency cap, Range download.
- Delivery docs: operator runbook, flags table, rollback steps.
