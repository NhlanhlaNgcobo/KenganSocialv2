# 10-user private beta — audit, changes, tests, deployment

Branch `feat/opensource-beta-10` (on top of `perf/browser-preview`) · 2026-10-28 · built from `KenganSocial_OpenSource_MVP_Build_Brief.md`.
**Nothing here has been deployed.** Production, DNS, credentials and user data were not touched.

## 1. Audit: brief vs. the actual repository

| Brief says | Repository actually has | Result |
|---|---|---|
| Add invite cap / entitlements | A 10-email allowlist gate (`server/config/pilot-access.json`, `middleware/pilotAccess.js`), no invite codes, no admin role, no seat counter | Extended: invite codes + seat cap; email list still works |
| Quotas config-driven, daily AI limit | Monthly per-workspace Redis counters (atomic Lua) with plan / trial / beta caps; **no daily limits**; **no connections cap**; storage checked only in one route | Pilot caps layered on the same counters + a UTC daily AI counter + connections cap |
| One user, one allowance | `POST /api/workspaces` had no cap, so a user could multiply per-workspace quotas | Pilot: one workspace per tester |
| `AIProvider` adapter, Ollama | Three separate LLM layers (`llm-client.js`, `gemini-json.js`, `ai.service.js`), no local model support; beta used the external free Pollinations fallback | `AI_PROVIDER=ollama` wired into all three, no paid/external fallback |
| Export via Python/FFmpeg worker | Editor exports render with **Node** FFmpeg inside the API (`timeline-render.service.js`); the Python `/process/render` is unused | Kept the Node FFmpeg path (it is the working one); added queue, deadline, cancel, idempotency, 720p/60 s |
| Exports bounded/cancellable/idempotent | No timeout, no cancel, no concurrency cap, no idempotency | Done (see §2.3) |
| Save export in private object storage | Exports stay in the server temp dir (72 h sweep), served by an authenticated download | **Not changed** (gap, §5) |
| R2 through the S3 adapter | `STORAGE_DRIVER=s3` exists with HMAC-signed `/api/private-media` links and 5-min presigned GETs; **no presigned PUT, no multipart** (large files use server-side resumable chunks) | Config only (§4); no code needed for private reads |
| OAuth state + PKCE, callback binding | HMAC-signed state with 15-min expiry, but **not single-use, no user binding, platform not compared**, no PKCE; whole axios errors logged (can contain client secret / auth code) | State fixed and logs cleaned; PKCE not added (web flows; §5) |
| Status model connected / approved / review / expired / manual | Only `active` / `expired` + a global `BETA_PLATFORMS` list | Per-network availability endpoint + UI |
| Publish idempotency | BullMQ `jobId = postId` and per-platform ids prevent re-posting, but a double-submitted create made two posts | `Idempotency-Key` on schedule create |
| LinkedIn / Pinterest / Threads / Bluesky / Mastodon | Not implemented (only YouTube, TikTok, Instagram, Facebook, Meta Ads) | Shown as "Export & post manually" |
| Remotion behind a flag | Used by AI video render, video ads, launch videos, thumbnails; **no flag**; the editor export does not use it | Not changed (gap) |
| `AGENTS.md` outdated | Same text as `CLAUDE.md` (generic Supabase/phases scaffold) — conflicts with the real Firebase/Express/Vite stack | Not edited: it is also the project instruction file; your call |
| `docs/DEPLOY.md` Google VM | Live beta is the Hostinger VPS (`deploy/hostinger/compose.yml`, Traefik, `BETA_ACCESS=on`) | Pilot overlay targets Hostinger |

## 2. What was built

### 2.1 Invite-only access (`PILOT_MODE=true`)
- `server/src/config/pilot.ts` — all `PILOT_*` settings (defaults = brief's 10-user column).
- `server/src/services/pilot-invites.ts` — one-time codes (72-bit, stored as SHA-256 only, 14-day expiry, optional email binding), seat cap in a Firestore transaction, member revoke frees the seat.
- `server/src/middleware/pilotAccess.js` — admits invite members **or** the legacy email list; 60 s membership cache; `PILOT_INVITE_REQUIRED` for others.
- `server/src/routes/pilot.ts` (`/api/pilot`) — `status`, `redeem` (10 tries / 15 min), admin: create/list/withdraw invites, revoke members, overview.
- Admins: Firebase custom claim `pilotAdmin` via `npx tsx scripts/pilot-admin.mjs grant <email>`. CLI also: `invite`, `add-member`, `revoke-member`, `status`.
- Client: invite form after sign-in (`components/auth/PilotInviteForm.jsx`, `/login?invite=CODE` links), admin dashboard `/dashboard/pilot-admin` (seats, per-tester usage today/month, invites, queue depth, exports by status, server load, costs).

### 2.2 Quotas (server-side, atomic, UTC)
Pilot caps apply on top of plan/beta caps (lower wins), via the existing Redis Lua counters:
exports 15/month · transcription 10 min/month · scheduled posts 20/month · connections 3 · storage 500 MB · **AI text 10/day** (new daily counter, reset 00:00 UTC, refunded with the monthly unit) · upload 200 MB/file · export 60 s, 720p.
Admin override per workspace: server-only field `pilotLimits: { exports: 40, aiCallsDaily: 20, … }`; `unlimited: true` still removes caps.

### 2.3 Exports (`EXPORT_CONCURRENCY`, `EXPORT_TIMEOUT_S`)
- `services/export-queue.js` — N at a time (pilot 1), others `queued` with a position; per-job deadline (default 4 × length + 2 min).
- `services/ffmpeg-runner.js` — every FFmpeg process inside a job is killed on cancel or deadline (AsyncLocalStorage, no call-site changes).
- `POST /api/video/manual-edit/cancel/:jobId` — refunds the export unit if it hadn't started.
- `Idempotency-Key` on export create (client sends one per export) — a double-click makes one job and one charge.
- Jobs past their deadline (e.g. after a restart) report `failed` instead of spinning forever.
- 720p: the timeline is composed at preset size (text/overlays unchanged) and scaled at the end.

### 2.4 Self-hosted AI (`AI_PROVIDER=ollama`)
- `services/ollama-client.js` — native `/api/chat`, `think:false`, output caps (700 text / 1 500 JSON tokens), 4 096 context, input trimmed to 12 000 chars, 90 s timeout, one-at-a-time queue (max 20 waiting → 503 `AI_BUSY`), `<think>` stripped, prompts/replies never logged, upstream error bodies never echoed.
- Used by `llm-client.js` (captions, hooks, hashtags, repurpose, DM drafts, trending), `gemini-json.js` (clips, plans; small-model JSON repaired) and `ai.service.js` (AI writer). `/api/ai/status` reports model health.
- `deploy/hostinger/compose.pilot.yml` — internal-only `ollama` service (no published port, 3 GB / 1 CPU cap), sets pilot + AI env for api and ai-worker, and `AI_FREE_FALLBACK=off`.

### 2.5 Social
- `services/oauth-state.ts` — state carries uid + workspace + platform, single-use nonce in Redis (fails closed in production), callback re-checks the user is still owner/admin; tampered/expired/replayed/cross-platform states refused.
- OAuth error logs: status + provider error code only.
- `GET /api/connections/availability` + Connections page panel: `approved-to-publish` / `connected` / `review-required` / `expired` / `manual-export-only`, with per-network notes (TikTok private-until-audit, YouTube quota, Meta review).
- `PUBLISH_APPROVED_PLATFORMS` also enforced when publishing (`betaPublishAllowed`).
- Connected-accounts cap at OAuth start; `Idempotency-Key` on schedule create; post recovery no longer aborts on one bad post.

### 2.6 Preview
`VITE_PREVIEW_ENGINE=browser_v1` (alias of `v2`) — the render-decoupled preview from `perf/browser-preview` (see `docs/performance-baseline.md`). Per-browser override `?preview=v2|legacy`.

## 3. Evidence (run on this branch, 2026-10-28)

| Check | Result |
|---|---|
| `server` `npx tsc --noEmit` | pass |
| `server` `npm run test:security` | **73 / 73 pass** (55 existing + 18 new: `pilot`, `ollama`, `export-limits`, `social`) |
| `client` `tsc --noEmit`, `vite build` | pass |
| `client` eslint on changed JS/JSX | pass (eslint config does not cover the TS editor files) |
| Invite race: 11 people, 10 seats | exactly 10 joined, 11th `PILOT_FULL`, existing members still pass |
| Daily AI cap on real local Redis | 3 allowed, 4th `429 DAILY_LIMIT_EXCEEDED`, refund restores one |
| Real FFmpeg export, 1080×1920 source, cap 720 | output 720×1280 with audio, 4.0 s |
| Cancel / timeout | running process killed within ~150 ms / at deadline |
| Ollama adapter | against a mock Ollama server only — **not yet run against a real Qwen3 model** (no Ollama/Docker on this PC, ~1 GB RAM free) |

Not run: real OAuth with test accounts, two-user isolation end-to-end in a browser, 25/50/100-editor load test, corrupt-media/disk-full chaos tests, real-device preview tests.

## 4. Staging deployment (needs your approval for each step)

1. **Back up** the VPS volumes (`uploads`, `renders`, `redis-data`), Firestore export, and the `TOKEN_ENCRYPTION_KEY` (do not rotate).
2. **Profile RAM**: `free -m` and `docker stats` with n8n running. Qwen3 1.7B needs ~2 GB resident; if less than ~3 GB is free, don't add Ollama yet.
3. On the VPS: `git fetch && git checkout feat/opensource-beta-10`, then `docker compose -f compose.yml -f compose.pilot.yml config` (validate; YAML was not machine-checked here).
4. `docker compose -f compose.yml -f compose.pilot.yml up -d --build`, then `… exec ollama ollama pull qwen3:1.7b`; check `GET /api/ai/status` shows `textAi.ok: true`.
5. Seed yourself: `npx tsx scripts/pilot-admin.mjs grant <you>` and `add-member <you>`; existing testers on `pilot-access.json` keep working.
6. Invite testers from `/dashboard/pilot-admin`.
7. **R2 (optional, after creating a private bucket + scoped key yourself)**: in `server/.env` set `STORAGE_DRIVER=s3`, `S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, `S3_REGION=auto`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`; leave `S3_PUBLIC_URL` empty. Existing local files are not migrated or deleted.
8. Frontend (Vercel): `VITE_PREVIEW_ENGINE=browser_v1` only after testers confirm `?preview=v2` works for them.
9. Set `PUBLISH_APPROVED_PLATFORMS=tiktok` (or whatever is approved).

**Rollback** — each is one change, no data loss:
- Invites/quotas off: `PILOT_MODE` unset.
- AI back to previous providers: `AI_PROVIDER` unset (or start without `compose.pilot.yml`).
- Export queue off: `EXPORT_CONCURRENCY` unset.
- Old preview: `VITE_PREVIEW_ENGINE` unset, or `?preview=legacy` per browser.
- Whole branch: redeploy the previous commit; Firestore additions (`pilot_*` collections) are inert.

## 5. Still open

- **Needs platform approval (you):** TikTok audit (public posts; until then private + 5 posting users/day), YouTube OAuth verification + upload quota, Meta app review (Instagram/Facebook publishing), LinkedIn `w_member_social` (connector not built), X off.
- Exports are not copied to object storage (temp dir + authenticated download, 72 h).
- Retained-storage cap (500 MB) is only enforced where storage was already checked (`routes/agency.ts`); editor media lives in the browser.
- OAuth login-CSRF: a signed-in user could still be sent an attacker's start link; full fix is a confirm step after the callback (as Meta multi-account already does). PKCE not added (web confidential clients).
- No Remotion off-switch; HyperFrames not evaluated; Bluesky/Mastodon connectors not built.
- Measured VPS requirements: **not measured** — estimate 2 vCPU / 8 GB is tight with n8n + Ollama; see `docs/cost-model.md`.
- Load tests for 25/50/100 editors not run.
