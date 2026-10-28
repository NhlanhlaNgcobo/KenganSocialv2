# Editor & video architecture audit

Branch `perf/browser-preview` · 2026-10-28 · scope: why the browser preview is slow, and what the media/export path costs.

## 1. How the editor works today

| Layer | Implementation | File(s) |
|---|---|---|
| UI | React 19 + Vite 7, editor derived from OpenCut (MIT, `LICENSE-OpenCut.txt`) | `client/src/editor/` |
| State | Zustand 5 stores: timeline, playback, media, project, ui | `client/src/editor/stores/` |
| Media during editing | Files kept in browser IndexedDB (`kengan-editor`), played from `blob:` URLs. **No network while editing.** | `stores/media-store.ts` |
| Preview | One `<video>`/`<audio>` per clip (`MediaLayer`), CSS transforms/filters, WebGL2 canvas for grades/LUTs/chroma key | `components/preview/` |
| Clock | `playback-store` rAF loop: `set({ currentTime })` every frame + window events `editor-playback-update` / `editor-playback-seek` | `stores/playback-store.ts` |
| Export | `POST` → `manual-edit.controller.js` → `renderTimeline()` (FFmpeg) **inside the API process** | `server/src/services/timeline-render.service.js` (1 199 lines) |
| Queue | BullMQ + Redis exists for AI edit jobs only (`ai-worker`), not for editor exports | `server/src/workers/` |
| Deploy (beta) | Hostinger VPS, 2 vCPU / 8 GB, shared with other apps; Traefik TLS; compose project `kengansocial-beta` | `deploy/hostinger/compose.yml` |

## 2. What makes the preview slow (measured, see `performance-baseline.md`)

**Correction to the first read.** The first baseline (8.9 fps at 1080p) was contaminated by editor start-up and the dev build. With a production build, a warm-up and ×4 CPU throttle, the legacy preview already presents ~28 fps for a 30 fps 1080p clip and ~25 fps for 4K on the test machine (6 cores, software decode). Per-frame React rendering is real main-thread waste, but on this machine it is **not** what limits frame rate.

What the data does show:

1. **Per-frame re-rendering (main-thread waste).** `PreviewPanel` read the whole playback store and its layer list depended on `currentTime`; `Timeline` subscribed to `currentTime` for the playhead. Legacy: ~125 renders/s for one clip, ~740/s for a project with 300 captions. This costs headroom on slower phones/laptops and competes with decode; v2 removes it (0.2 renders/s, ~78/s with captions).
2. **Seek latency.** Seeks were not coalesced; a scrub cancels the seek in flight. p95 278 ms (legacy) → 214 ms (v2) on short-GOP test media. **Real phone footage has keyframes seconds apart, so seeks there are much slower; the synthetic bench media does not represent this.** Proxies (short GOP) are the likely biggest win for real-world scrubbing.
3. **Long projects.** Fps drops to ~20–22 with 300 captions in both engines; results vary run to run (v2: 14.4 and 25.7). Needs more runs and profiling (caption layout, membership churn) before claiming a fix.
4. **Edit latency.** ~22 ms per trim/text edit at ×4 (≈ 5–6 ms unthrottled); every edit re-renders preview + timeline. v2 measured ~6 ms *slower* per edit in both runs — not yet explained, to investigate before v2 becomes the default.
5. **Not yet measured:** HEVC/ProRes phone files, real low-end devices, very long timelines (> 200 elements: no virtualisation), colour-panel LUT rebuilds (33³ per slider move), waveform decoding on the main thread.

## 3. Export / server findings

| Finding | Risk | Evidence |
|---|---|---|
| Exports render in the API process | A long render competes with API requests on 1.5 CPU | `manual-edit.controller.js:127` |
| No render timeout or cancel | A stuck FFmpeg holds CPU until restart | `timeline-render.service.js` |
| No global export concurrency cap | Two parallel 1080p exports saturate the VPS | compose CPU caps total 3.75 on 2 vCPU |
| Export download has no HTTP Range support | No resumable download / seeking in the result | download route |
| Containers run as root | Larger blast radius on a shared VPS | `compose.yml` (no `user:`) |
| Redis not published to the host | OK | `compose.yml` (no `ports:` on redis) |

## 4. What does not need to change

- Browser-local media (IndexedDB + `blob:`) already gives zero egress and zero server cost while editing. R2 is only needed for originals that must outlive the browser, proxies and exports.
- `<video>`-element decoding held ~25–29 fps in every scenario measured (software decode, ×4 throttle); a WebCodecs/WebAV rewrite is **not** justified by the data yet (see `migration-plan.md`).
- No GPU host (Runpod) is justified: preview runs in the browser; export CPU time is the only server cost.

## 5. Fix shipped on this branch (behind a flag)

`client/src/editor/lib/preview-engine.ts` — `VITE_PREVIEW_ENGINE=legacy|v2` (build default `legacy`), per-browser override `?preview=v2|legacy`.

- **Preview (v2):** `PreviewPanel` re-renders only when the set of mounted/visible layers changes. Each layer is a memoised `PreviewLayer`; it follows the playhead itself only if it animates (transition, keyframes, effects, Ken Burns/camera motion, caption motion, pop/fade). `Timecode` and `TransitionWash` subscribe on their own.
- **Timeline (v2):** `LivePlayhead` moves via a direct `style.left` update from a store subscription and handles auto-scroll; the track tree no longer re-renders per frame.
- **Seek coalescing (v2):** while a `<video>` is seeking, only the latest target is kept and applied on `seeked`.
- **Both engines:** selector reads instead of whole-store reads in `PreviewPanel`; `MediaLayer` wrapped in `React.memo`.

Rollback: `?preview=legacy` for one browser; unset `VITE_PREVIEW_ENGINE` and redeploy for everyone.
