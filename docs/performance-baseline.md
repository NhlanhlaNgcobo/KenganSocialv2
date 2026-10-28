# Editor preview performance baseline

2026-10-28 · Branch `perf/browser-preview`. Raw results: `docs/perf-results/b2-{legacy,v2}-r{1,2}.json`.

## How to reproduce

```bash
cd client && npx vite build && npx vite preview --port 4173   # production build
cd server && npx tsx ../scripts/bench-editor.mjs --media <dir> --url http://localhost:4173 \
    --cpu-throttle 4 --preview legacy|v2 --label <name> --out <file>.json
```

The script signs in a temporary test account, opens `/editor?perf=1&preview=<engine>`, imports the media into the editor's local store, runs a 4 s warm-up playback (not recorded), then the scenarios, and deletes the test account. Metrics come from `client/src/editor/lib/perf.ts` (`window.__kePerf`): presented frames via `requestVideoFrameCallback`, dropped frames via `getVideoPlaybackQuality`, long tasks (> 50 ms), seek → next presented frame, and React renders per component.

**Environment:** headless Chrome 157 (chrome-headless-shell), 6 cores, 8 GB, SwiftShader GPU (software decode/compositing), CPU throttled ×4 via CDP. Media: synthetic H.264 1080p30 (30 s), H.264 4K30 (15 s), AAC music. **Short-GOP synthetic media; real phone footage is not represented.**

## Results (mean of 2 runs per engine, alternating legacy/v2)

| Scenario | Metric | Legacy | v2 |
|---|---|---|---|
| 1080p single clip, play 8 s | presented fps (source 30) | 28.4 | 28.9 |
| | long tasks ms | 143 | 131 |
| | renders/s (panel + timeline + layers) | ~125 | **0.2** |
| 4K clip, play 8 s | presented fps | 24.8 | 25.5 |
| | long tasks ms | 1 272 | 869 (1 507 / 231) |
| Multi-track (video + music + 4 texts) | presented fps | 27.1 | 26.9 |
| | renders/s | ~290 | **2.6** |
| 10 scrubs, paused | seek p50 / p95 ms | 156 / 278 | 145 / **214** |
| 60 trims + 60 text edits | ms per edit | **21.9** | 27.7 |
| Long project (20 cuts, 300 captions), play 8 s | presented fps | 22.1 | 20.1 (14.4 / 25.7) |
| | long tasks ms | 1 314 | 1 651 (3 175 / 127) |
| | renders/s | ~740 | **~78** |

No page errors in any run. Media bytes downloaded and backend calls during editing: **0** in every scenario (preview plays local `blob:` URLs).

## Reading the numbers

- v2 removes ~99 % of per-frame React renders. On this 6-core machine that does **not** translate into a measurable fps gain: legacy already presents near-source frame rate once warmed up. The benefit is headroom for slower devices, which this bench does not yet cover.
- Seek coalescing lowers scrub p95 by ~23 %.
- v2 is ~6 ms slower per edit in both runs; cause not yet found. Edits still re-render preview and timeline in both engines (throttling edit writes is a separate fix).
- The long-project and 4K scenarios vary a lot between runs; two runs are not enough to call a winner there.
- The earlier single-run baseline (1080p 8.9 fps) included editor start-up; the warm-up phase fixes that measurement. Dev-server numbers (React dev mode) are not comparable to these.

## Gaps before v2 becomes the default

1. Explain/fix the edit-latency regression.
2. ≥ 5 runs of the long-project and 4K scenarios.
3. Real phone footage (HEVC, long GOP) and a real low-end laptop/phone.
4. Very long timelines (> 200 elements), colour grading sliders, waveform import.
