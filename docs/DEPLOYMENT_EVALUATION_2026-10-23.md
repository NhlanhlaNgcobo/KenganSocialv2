# Deployment readiness evaluation

| Item | Result |
| --- | --- |
| Date | 23 October 2026, Africa/Johannesburg |
| Source revision | `d147ea7`; working tree initially clean |
| Public / paid deployment | **NO-GO** |
| Private pilot | Conditional: resolve security blockers, then validate the deployed stack with test accounts and test payments |
| Scope | Local source review, installed-dependency checks, selected automated tests; no deployment or production data changes |

## Executed checks

| Check | Result |
| --- | --- |
| Client production build: `npm.cmd run build` | PASS; main JS bundle 1,920.78 kB (580.14 kB gzip), chunk-size warning |
| Client lint: `npm.cmd run lint` | PASS: 0 errors, 4 React Hook dependency warnings |
| Server: `npx.cmd --no-install tsc --noEmit` | **FAIL: 23 TypeScript diagnostics** |
| Video-ad core, drafts and actual MP4 media tests | **PASS: 14/14** |
| Shared client/server editor files | PASS |
| Keyframe checks | PASS: 12 checks |
| Beat detection and timing checks | PASS |
| Template schema and built-in template checks | PASS |
| Python AST syntax validation | PASS: 5 top-level Python modules |
| Server `npm audit --omit=dev --json` | 47 affected-package findings: 3 critical, 23 high, 19 moderate, 2 low |
| Client `npm audit --omit=dev --json` | 9 affected-package findings: 8 high, 1 moderate |
| Docker image build / Compose startup | NOT VERIFIED: Docker unavailable in this environment |
| Live authentication, payment, social publishing, restore and load tests | NOT RUN |

Audit counts include dependency chains and are not counts of confirmed exploitable vulnerabilities. Browser reachability, vulnerable feature use, and available upgrades must be assessed individually. Production Docker currently installs dev dependencies too, so the production-only server audit is not a complete image audit. Existing dependencies were used; clean `npm ci` reproducibility was not tested.

The PowerShell `npm.ps1` policy prevented the initial commands from launching. Using `npm.cmd` resolved this without changing machine policy. Type-check output was captured through a PowerShell wrapper; its final shell exit status is not the compiler result. The 23 diagnostics establish failure.

## Launch blockers

### B1 — High: unrestricted video input reaches the internal downloader

- Evidence: `server/src/routes/video.ts:190` forwards caller-supplied `videoUrl` to `/process/transcribe`; `python-service/main.py:217` accepts `file://`, existing local paths, and arbitrary HTTP URLs with redirects.
- Impact: an authenticated caller with transcription allowance can cause internal network requests or local-file processing under the Python service's permissions. Shared media can potentially be processed without checking its owner. No live exploitation or arbitrary-secret exfiltration was tested.
- Required: use an ownership-checked upload ID, as `/api/video/process` already does. Restrict local reads to the trusted shared directory. If remote URLs remain supported, validate destinations and redirects, deny private/internal addresses, and bound size and time.
- Acceptance: tests reject another user's file, paths outside the allowed root, loopback/private destinations and redirects into them.

### B2 — High: viewer membership permits publishing and ad changes

- Evidence: `server/src/middleware/withWorkspace.ts` verifies membership but neither resolves nor enforces a member role. `server/src/routes/ads.ts:30` uses only this middleware plus a non-null workspace check; status and budget changes are at lines 45 and 51. `server/src/routes/schedule.ts:205` similarly permits publish-now with no role guard.
- Impact: a viewer can change campaign budgets/status or publish scheduled content in their workspace. This is a role-boundary failure, not evidence of access to another workspace's ad account.
- Required: explicit role permissions for writes, publishing, spending and billing changes, applied consistently to every route.
- Acceptance: viewer write requests return 403; permitted roles succeed; cross-workspace requests remain denied.

### B3 — High: export writes lack job ownership checks

- Evidence: `server/src/routes/video.ts:236` accepts a caller's `jobId` and writes under `render_jobs/{jobId}/exports` without loading and checking the parent job's workspace.
- Impact: a caller with export allowance can create export records under a different workspace's known job ID. The referenced Python `/process/export` endpoint is absent from `python-service/main.py`, so this route also cannot complete through the configured service.
- Required: validate the ID, existence and ownership before writing; implement the downstream contract or remove the obsolete route.
- Acceptance: foreign and nonexistent jobs cannot be mutated; a valid export completes end to end.

### B4 — High: recurring paid access is incomplete

- Evidence: `server/src/routes/billing.ts` initializes a transaction without a recurring plan, handles only `charge.success`, and stores `currentPeriodEnd`. `server/src/utils/trial.ts:45` selects the paid plan without checking that date or payment status. The only server references to `currentPeriodEnd` are in the billing route.
- Impact: a successful payment can grant paid access indefinitely; renewal, failed payment and cancellation are not reflected in entitlement enforcement.
- Required: choose and implement recurring subscriptions or explicitly time-limited one-off access. Enforce paid entitlement expiry and provider lifecycle events.
- Acceptance: test initial payment, renewal, expiry, failed payment, cancellation and out-of-order webhook delivery against actual API access.

### B5 — High: payment deduplication can permanently skip activation

- Evidence: `server/src/routes/billing.ts:132` commits the processed-payment marker in a transaction, then updates the workspace separately. A retry encountering the marker returns already processed.
- Impact: process termination between the marker commit and workspace update leaves a paid customer without access; the catch-based cleanup cannot run after process termination.
- Required: atomically update both documents, or persist a recoverable processing state with reconciliation.
- Acceptance: fault injection between receipt and activation followed by retry grants access exactly once.

### B6 — High: dependency and automated quality gates are not clean

- Evidence: saved audit JSON and TypeScript diagnostics in `deployment-evaluation-2026-10-23/`.
- Server critical audit entries include `protobufjs`, `proxy-addr` and `websocket-driver`; direct high entries include `axios`, `multer`, `puppeteer-core` and `@remotion/renderer`.
- Type errors include missing `../utils/stripe` and `../utils/notifications` modules, missing upload types and webhook dispatcher typing errors. Missing modules may be in unused code; these diagnostics alone do not establish startup failure.
- Required: triage reachable advisories, update dependencies with regression checks, resolve compiler errors and review lint warnings, and add repeatable CI gates. Avoid blindly applying forced audit fixes.
- Acceptance: clean build/type/lint checks and documented disposition of all critical/high production findings.

## Additional release risks

| Priority | Finding / evidence | Required action |
| --- | --- | --- |
| High | `withWorkspace.ts:77` allows a null workspace when none was requested; `/api/schedule/draft` persists that value and update/delete/publish compare workspace values directly. Workspace-less users can therefore share the same null authorization scope for known draft IDs. | Reject missing workspace on all tenant routes; test two users without workspaces. |
| High | `server/server.js:141` serves local uploads anonymously. Possession of a URL grants file access, without membership checks or expiry. | Define which assets may be public; use authenticated or short-lived signed access for private originals and explicit temporary publishing links. |
| Medium | `planGate.ts:37` reads a quota before a separate increment transaction. Parallel requests can both pass the same remaining allowance. | Use an atomic compare-and-increment operation; test concurrency at the cap. Video-ad reservation tests do not cover this separate general quota implementation. |
| Medium | `manual-edit.service.js:13` keeps upload ownership/path mappings only in a process-local Map. | Persist upload metadata and validate recovery after API restart; a persistent media volume alone is insufficient. |
| Medium | `/api/health` returns a fixed healthy result without Redis, Firestore or video-service checks. Compose dependency ordering does not establish readiness. | Separate liveness/readiness; test dependency failure and recovery. |
| Medium | Schedulers and long-running work execute within one API instance; no API shutdown handler was found. Deployment docs require a single VM. | Drain work on shutdown; prove no lost/duplicate jobs on redeploy before scaling replicas. |
| Medium | `schedule.ts:184` reads all tenants' posts within the date range, then filters in memory. | Scope the database query by workspace and add the corresponding index. |
| Medium | `storage.rules` applies `request.resource.size` to reads as well as writes; reads lack the incoming resource used by that check. | Split and emulator-test read/write policies before using browser Firebase Storage. Local-storage deployments bypass these rules. |
| Medium | Python requirements are mostly unpinned; the server package's plain Node start command differs from Docker's `tsx` startup. | Lock Python dependencies and validate the exact production command/runtime on a clean host. |
| Medium | Existing launch notes still describe Firestore rules that no longer match the current default-deny rules. | Refresh the operational checklist from current code and deployed configuration. |
| Low | Frontend build emits a 1.92 MB main JS bundle; ESLint covers JS/JSX but not the editor's TS/TSX files. | Split routes where practical and add a frontend TypeScript validation gate. |

## Existing strengths

- Docker Compose, Caddy HTTPS configuration, persistent volumes and deployment instructions exist.
- API and video service share the configured temp volume; video and Redis have no published host ports.
- Firebase bearer authentication, workspace membership checks and header/URL workspace mismatch rejection exist.
- Firestore rules deny browser access to server-owned collections; users can read their own profile/consent records.
- Helmet, production CORS configuration and baseline API rate limiting are present.
- Paystack webhook signature verification exists; payment deduplication is present but needs the atomicity correction above.
- Docker ignore files exclude environment and service-account files. No `.env` secret files appeared in the tracked-file listing; this was not a repository-history secret scan.
- Video-ad unit/media tests and selected editor checks pass.

## Required deployment verification

1. Resolve B1–B6 and the null-workspace/private-media issues; add focused authorization and billing regression tests.
2. Build both images on the target Linux environment; validate proxy configuration and start the entire stack with staging credentials.
3. Verify sign-up, consent, workspace creation, invitations, viewer permissions and cross-tenant denial with separate users.
4. Exercise upload, transcription, editor export, scheduling and one approved social-provider test account.
5. Exercise payment lifecycle and duplicate/crash webhook cases in provider test mode.
6. Restart API, video and Redis during representative jobs; verify durable recovery and quota accounting.
7. Restore Firestore and media backups into an isolated environment; record recovery time and data loss window.
8. Run the existing `scripts/check-deploy.mjs` against the actual staging domains; verify HTTPS, CORS, public pages and frontend API configuration.
9. Confirm production secrets, provider app approvals, deployed Firebase rules/indexes, alerts and privacy/retention arrangements. Their live state was not accessible in this evaluation; this is not a legal-compliance certification.

## Limits of this evaluation

- Source findings above are static unless explicitly marked as executed tests. No authenticated attack requests were sent to live services.
- Redis-backed video-ad billing and route tests were not run; they were not treated as substitutes for real payment integration tests.
- No browser journey, external-provider transaction, cloud configuration inspection, Docker startup, performance test or backup restore was performed.
- Frontend compilation used local environment settings; success does not verify production API URLs or cloud environment variables.
- No numeric readiness percentage is assigned: unresolved authorization and billing gates make a percentage misleading.

