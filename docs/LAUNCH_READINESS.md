# KenganSocial: getting ready for testers and a multi-tenant launch

This document lists what is needed to put KenganSocial in front of a small group of testers, and then what it takes to run it as a proper multi-tenant product for creators and agencies. It reflects the code as of October 2026.

It is ordered by urgency: section 2 blocks a tester invite, section 3 is about letting many independent businesses share one deployment safely, and section 4 is what to do before charging money at scale.

---

## 1. Where things stand

Working end to end on a local machine (tested):

| Area | What works |
| --- | --- |
| Accounts | Firebase email/password and Google sign-in, onboarding, one workspace per user, inviting existing users as members with roles |
| Clips | Upload a long video, get ranked short clips (score, title, hook, caption), reframed to 9:16 / 1:1 / 16:9 with burned-in captions, download, open in editor, hand off to the calendar |
| Repurpose | Article link, pasted text or a clip transcript to native posts for LinkedIn, X, Instagram, TikTok, Threads, Facebook and YouTube; schedule text posts to the next free slot |
| Video editor | Multi-track timeline, templates, captions, music library, stabilisation, auto-framing, server export |
| Launch video | Website or description to a short promo video with music and a caption |
| Calendar | Monthly planning, scheduling through the Redis queue |
| Music | 1,443 royalty-free tracks (CC BY 4.0) with genre and mood filters |

Not yet usable by testers:

- **Connecting social accounts.** None of the platform app credentials are set (YouTube, Facebook/Instagram, TikTok, LinkedIn, Pinterest, Threads), so the Connections page cannot complete a sign-in, and nothing can publish. See 2.4.
- **Analytics and Inbox** only fill in once accounts are connected.
- **Payments** (Paystack) are wired but untested end to end.

---

## 2. Before you invite testers

### 2.1 Hosting

Four parts need to run somewhere other than your laptop:

| Part | Folder | Suggested host | Notes |
| --- | --- | --- | --- |
| Web app | `client/` | Firebase Hosting (already configured in `firebase.json`) | `npm run build`, then `firebase deploy --only hosting` |
| API | `server/` | A VPS or Cloud Run, 2 vCPU / 4 GB minimum | Needs FFmpeg and Chrome for Remotion (the `Dockerfile` installs FFmpeg). Run **one instance** for now, see 2.6 |
| Video service | `python-service/` | A VM with 4+ vCPU / 8 GB (Hetzner CPX31, DigitalOcean CPU-optimised) | Runs Whisper transcription, scene detection, stabilisation. CPU is fine for testing; a GPU makes transcription about 10× faster |
| Queue | Redis | Upstash or Redis Cloud free tier | Set `REDIS_URL` |

For a first test round, the simplest setup is one VM that runs the API, the video service and Redis together, with the web app on Firebase Hosting. Put the API behind a domain with HTTPS (for example `api.kengansocial.com`); the social platforms will not redirect to plain `http`.

### 2.2 Production settings

In the production `server/.env` (never commit it):

- `NODE_ENV=production`. This also turns off `DEV_PLAN_OVERRIDE` and locks CORS to `CLIENT_URL`.
- Remove `DEV_PLAN_OVERRIDE` entirely.
- `CLIENT_URL` / `FRONTEND_URL` = the web app's URL; `SERVER_URL` = the API's public URL (used to build OAuth redirect URIs).
- `TOKEN_ENCRYPTION_KEY` = 32+ random characters. It encrypts social tokens; changing it later disconnects every account.
- `OPENROUTER_API_KEY` and/or `GEMINI_API_KEY`; `PYTHON_API_URL` pointing at the video service.

In `client/.env` before building: `VITE_API_URL=https://<api-domain>/api` and the Firebase web config.

`.env.example` lists every variable the code reads.

### 2.3 Firebase

1. Deploy the indexes and rules from this repo: `firebase deploy --only firestore:indexes,firestore:rules,storage`. Two screens (scheduler queue, AI usage) fail with "query requires an index" until this is done.
2. Firebase Auth, then Settings, then Authorized domains: add the production web domain.
3. Google sign-in: configure the OAuth consent screen with the app name, logo, privacy policy URL and support email.
4. Fix the Storage rule before using Storage: it checks `request.resource.size` on reads, where `request.resource` is empty, so reads are refused. Split it into `allow read` (membership only) and `allow write` (membership plus size).
5. Turn on Firestore point-in-time recovery or scheduled exports, so a bad deploy can be undone.

### 2.4 Social platform apps

Each platform needs a developer app, with the redirect URI `${SERVER_URL}/api/connections/<platform>/callback`. All of them allow a small number of testers before review, which is enough for a pilot:

| Platform | Variables | Testing without review | Needed for the public |
| --- | --- | --- | --- |
| YouTube | `YOUTUBE_CLIENT_ID/SECRET` | OAuth consent in "Testing" with up to 100 listed test users (they see an "unverified app" warning) | Google verification of the `youtube.upload` scope |
| Instagram and Facebook | `FACEBOOK_APP_ID/SECRET`, `META_APP_SECRET`, `META_VERIFY_TOKEN` | App in Development mode; testers added under App roles; Instagram must be a Business/Creator account linked to a Page | Meta App Review for content publishing and messaging permissions, plus Business Verification |
| TikTok | `TIKTOK_CLIENT_KEY/SECRET` | Sandbox with listed test accounts; unaudited apps can only post as private | Content Posting API audit |
| LinkedIn | `LINKEDIN_CLIENT_ID/SECRET` | "Share on LinkedIn" product is self-serve | Community Management API approval for company pages |
| Threads | `THREADS_APP_ID/SECRET` | Testers added to the Meta app | Meta App Review |
| Pinterest | `PINTEREST_APP_ID/SECRET` | Trial access | Standard access review |

Start with YouTube and LinkedIn: they are the quickest to get working for testers.

### 2.5 Giving testers access to paid features

With `NODE_ENV=production`, everyone starts on the Starter plan. For testers, set the plan by hand in Firestore: `workspaces/{workspaceId}` → `plan: "creator"` (or `"agency"` to try Leads). Alternatively, put Paystack in test mode and let them subscribe with a test card, which also tests billing.

### 2.6 Known limits that will affect testers

- **Uploads and rendered videos live on the API server's disk**, and their IDs are kept in memory. If the API restarts, uploads in progress and download links for older clips stop working. This is fine for a short pilot on one instance. Fix it before scaling (3.4).
- **Rendering runs inside the API process**, one clip project and one launch video at a time. A 6-minute video takes about 5 minutes to turn into 3 clips on a laptop; testers working at once will queue behind each other.
- **Firestore is in `nam5` (United States).** It works, but adds latency from South Africa, and is a cross-border transfer under POPIA (section 5). The location cannot be changed on an existing database.
- **Invites only work for people who already have an account.** Ask testers to sign up first, then add them from Settings.

### 2.7 Tester checklist

1. Deploy (2.1–2.3) and connect at least YouTube or LinkedIn (2.4).
2. Create the tester accounts, or have testers sign up, then set their plan (2.5).
3. Send each tester: the URL, the test-user email you registered for each platform, and three tasks:
   - Turn a long video of your own into clips and schedule one.
   - Repurpose a blog post or newsletter into posts.
   - Edit a clip in the editor and export it.
4. Watch the server logs during the first sessions, and collect feedback in one place (a form or a shared doc).

---

## 3. Making it properly multi-tenant

### 3.1 How tenancy works now

- A **workspace** is the tenant. `workspaces/{id}` holds `ownerId` and `plan`; `workspaces/{id}/members/{uid}` holds each member's role (`owner`, `admin`, `editor`, `viewer`).
- The API resolves the caller's workspace on every request. Newer routes use `withWorkspace` (`server/src/middleware/withWorkspace.ts`), which verifies the Firebase token and membership. Older routes use `requireAuth` + `requireRole` (`server/src/middleware/auth.middleware.js`).
- Plan limits are enforced per workspace by `planGate` (`checkLimit`, `planRateLimit`).

### 3.2 Fixed in this round

These allowed one workspace to reach another's data and are now closed. They were verified with a test user who is not a member:

- `requireRole` trusted the `x-workspace-id` header over the workspace in the URL. A user could name their own workspace in the header and someone else's in the URL, then read or change that workspace's content, connections, automations and media. The URL now wins, and a mismatch is refused.
- `/api/scheduler/stats|queue|process/:workspaceId` and `/api/ai/credits|usage/:workspaceId` only checked that the caller was signed in. Anyone could read another workspace's numbers, or trigger its scheduled posts to publish. They now require membership.
- `/api/ai/generate`, `/generate-media` and `/video/render` charged credits to a `workspaceId` taken from the request body without checking membership.
- Clip projects refuse requests without a workspace, so they can never be listed across tenants.

### 3.3 Still to do

1. **Guarantee every user has a workspace.** `withWorkspace` lets users without one through with `workspaceId = null`. Make onboarding always create one, and have `withWorkspace` refuse workspace-scoped routes when it is missing, rather than each route checking.
2. **Audit every Firestore query** for a `workspaceId` filter, especially older controllers that read `req.params.workspaceId` directly. A short integration test that replays the cross-tenant checks in 3.2 against every route would catch regressions.
3. **Firestore rules for client reads.** The web app mostly goes through the API, but the rules are the last line of defence. `scheduled_posts` uses `resource.data` on create, where there is no `resource`; use `request.resource.data`. New server-only collections (`clip_projects`, `manual_edit_jobs`) are covered by default-deny; keep it that way.
4. **Per-tenant file storage.** Move uploads and outputs to Firebase Storage under `workspaces/{workspaceId}/…`, record ownership in Firestore instead of in memory, and give downloads short-lived signed URLs. This also removes the single-instance limit.
5. **Email invites.** Let owners invite an email address that has no account yet (a pending invite that is claimed at sign-up).
6. **Agencies managing several clients.** Allow one login to belong to several workspaces, with a workspace switcher in the sidebar, per-client connected accounts, brand kits (logo, fonts, caption style) and per-client approval before posting. The data model already supports membership in several workspaces; the switcher and brand kits are missing.
7. **Roles in the UI.** Hide or disable actions a viewer or editor cannot take, instead of letting the API refuse them.
8. **Usage visibility.** A per-workspace page showing renders, AI calls and storage against plan limits.
9. **Data export and deletion per workspace** (section 5).

### 3.4 Scaling past a handful of users

- Move clip, launch and editor renders to background workers on the existing Redis/BullMQ queue, so the API stays responsive and several renders run in parallel on separate machines.
- Store media in object storage behind a CDN, and delete raw uploads after a retention period (30 days, for example) to control cost.
- Run the Python service on a GPU instance, or switch transcription to AssemblyAI (`TRANSCRIPTION_PROVIDER=assemblyai`), once volume grows.
- Add error tracking (Sentry) and uptime checks on `/api/health` and the video service's `/health`.
- Cap AI spend per workspace and alert on unusual usage. A single long video uses one transcription and one model call per clip project; Repurpose uses one model call per run.

---

## 4. Before charging money

- Test the Paystack flow end to end in test mode: subscribe, renew, fail a payment, cancel, and confirm the workspace plan changes each time (webhook to Firestore).
- Make sure limits match the pricing page (`client/src/utils/planLimits.ts` and `server/src/middleware/planGate.ts`).
- Get platform app reviews approved (2.4); without them, only listed test users can connect accounts.
- Write a short terms of service that covers user-uploaded content and the platforms' own terms.

---

## 5. Legal and licences

- **POPIA**: register an Information Officer with the Information Regulator. Keep the privacy policy accurate about what is stored (videos, transcripts, social tokens, messages and leads). Get consent at sign-up, provide data export and deletion, and disclose that data is processed in the US (Firestore `nam5`, AI providers).
- **Music**: library tracks are Kevin MacLeod, CC BY 4.0. The credit line must appear with published videos; the app adds it to captions and shows it on add.
- **Remotion** (launch videos) is free for companies of up to 3 people; larger companies need a Remotion company licence.
- **AI providers**: transcripts and article text are sent to OpenRouter (Anthropic models) or Google Gemini. Mention this in the privacy policy.
- **Platform policies**: automated DMs and comment replies must follow Meta's and TikTok's messaging rules (for example, Meta's 24-hour reply window).

---

## 6. Order of work

1. Hosting, production settings and Firebase deploy (2.1–2.3).
2. YouTube and LinkedIn apps in testing mode (2.4), testers' plans (2.5), invite 3–5 testers (2.7).
3. During the pilot: guarantee workspaces (3.3.1), move files to Storage (3.3.4), fix the Storage and `scheduled_posts` rules.
4. Before a wider launch: workers (3.4), Meta and TikTok reviews, Paystack testing, POPIA paperwork, agency workspace switcher.
