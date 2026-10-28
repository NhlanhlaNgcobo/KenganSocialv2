# Video infrastructure cost model (< 100 concurrent editors)

2026-10-28 · Assumptions are marked **A**; anything measured is cited. Prices are list prices at the time of writing; check before committing spend.

## 1. Where cost comes from

| Activity | Runs on | Marginal server cost |
|---|---|---|
| Editing + preview | User's browser (IndexedDB media, `blob:` playback) | **0** — no egress, no CPU |
| Upload of an original (only when the server needs it: Clips, export) | API → disk today; R2 later | storage + 1 write |
| Preview proxy (planned, Phase 3) | Server FFmpeg, once per upload | CPU seconds + proxy storage |
| Export | Server FFmpeg | CPU seconds (dominant cost) + output storage |
| Download of export | API today; R2 signed URL later | 0 egress on R2 |

The browser-first preview means editor count barely moves cost. **Exports per day** do.

## 2. Export CPU

Measured 27 Oct (`deploy/hostinger/compose.yml` comment): a 30 s clip took 2 min 20 s at 0.5 CPU → ≈ **70 CPU-seconds per 30 s of 1080p output**, ≈ 2.3 CPU-s per output second.

| **A** | Value |
|---|---|
| Active editors / day | 100 |
| Exports per editor / day | 2 |
| Average export length | 45 s |

→ 200 exports × 45 s × 2.3 CPU-s ≈ **20 700 CPU-s/day ≈ 5.8 CPU-hours/day**.

Current VPS: 2 vCPU shared with other apps, API capped at 1.5 CPU. 5.8 CPU-h spread over a day fits, but **peaks do not**: 10 exports queued at once at 1.5 CPU is ~7 min of wait for the last one. This is why Phase 5 adds a queue with a concurrency cap (1–2) instead of more hardware.

## 3. Storage (Cloudflare R2, planned Phase 4)

R2 list price: $0.015 / GB-month, **no egress fee**, Class A (writes) $4.50 / million, Class B (reads) $0.36 / million; free tier 10 GB-month, 1 M Class A, 10 M Class B per month.

| Bucket | **A** volume | Retention | GB held | $/month |
|---|---|---|---|---|
| `kengan-originals` | 100 users × 2 GB uploaded/month | 30 days | ~200 | ~3.00 |
| `kengan-proxies` | 540p ≈ 8 % of original size | while project exists | ~16 | ~0.24 |
| `kengan-exports` | 200 × 30 days × 40 MB | 30 days | ~240 | ~3.60 |
| Requests | < 1 M writes, < 10 M reads | | | 0 (free tier) |
| **Total** | | | ~456 GB | **≈ $6.85 / month** (≈ $6.70 after the 10 GB free tier) |

Lifecycle rules (delete after N days) are what keep this flat; without them storage grows linearly.

## 4. Compute options for exports

| Option | Monthly | Fits 5.8 CPU-h/day? | Notes |
|---|---|---|---|
| Current Hostinger VPS (shared) | already paid | yes on average, queue at peaks | No new spend; needs queue + cap |
| Dedicated export worker on the same VPS | 0 | same CPU pool | Isolation via container caps only |
| Small extra VPS for the worker (2–4 vCPU) | **A** low tens of USD | yes, with headroom | Only if queue wait p95 > 2 min in practice |
| GPU host (Runpod etc.) | — | — | **Not justified**: FFmpeg CPU export is fine at this scale; no profiling shows a GPU need |

## 5. What changes the numbers

- Exports per editor and export length (linear in CPU).
- 4K exports: roughly 4× the CPU of 1080p — gate behind a paid tier.
- Proxy generation adds ≈ 0.3–0.5 CPU-s per source second (**A**, 540p ultrafast); measure in Phase 3 before enabling for everyone.
