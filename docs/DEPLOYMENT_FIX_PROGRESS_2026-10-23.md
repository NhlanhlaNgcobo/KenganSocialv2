# Deployment fix progress

Public launch remains blocked. The Word checklist records five locally verified items and eight partial items. This update covers the working tree, not a deployed release.

## Verified evidence

| Check | Result |
| --- | --- |
| Server TypeScript | Pass |
| Client TypeScript | Pass; JS checking remains disabled |
| Client ESLint | Pass, no warnings |
| Production frontend build | Pass; large bundle and mixed Firebase import warnings remain |
| Server and client npm audits | Zero vulnerabilities in both installed dependency graphs |
| Security and billing tests | 8 passed; mocked Firestore/provider, real local Redis |
| Video-ad regressions | 16 passed, including actual FFmpeg MP4 output |
| Python media boundary test | 1 passed |
| Shared editor module comparison | Pass |

Commands: `npm run typecheck` in server/client, `npm run lint` and `npm run build` in client, `npm run test:security` and `npm run test:video-ads` in server, `python -m unittest discover -s tests -v` in python-service, `node scripts/check-shared.mjs`, and `npm audit --json` in each npm package.

## Implemented fixes

- Owned upload IDs replace caller-provided video source paths; Python permits regular files within the shared root only.
- Missing tenant scopes fail closed. Viewer writes are denied; billing, connection changes and ad spending changes require owner/admin.
- Obsolete video export returns HTTP 410 without modifying jobs.
- Payment activation and its deduplication receipt share one Firestore transaction. Older charges cannot overwrite newer paid periods.
- Paystack checkout uses recurring monthly/annual plans. Lifecycle events reconcile current provider state; invoice success verifies the charge before granting access. Subscription management opens Paystack's hosted link. Expired paid periods lose paid access; cancellation retains already-paid time.
- Quotas reserve atomically in Redis with bounded connection/command waits. Thirty parallel reservations against four remaining uses grant exactly four.
- Upload registry metadata persists on disk. Readiness checks Redis, Firestore and the video service; Docker health dependencies use readiness.
- Calendar queries filter by workspace. Storage rules distinguish reads, writes and deletes and check member roles.
- Firebase Admin 14 imports migrated to modular APIs. Runtime tsx is a production dependency. API Docker runtime updated to Node 24. CI workflow added.

## Limits and remaining work

- Private media URLs and anonymous upload serving remain a security blocker. Storage-rule changes alone do not fix server-generated public links.
- Paystack sandbox checkout, renewal, failure and cancellation have not been exercised. No customer was charged or enrolled. Existing one-off customers require a deliberate migration; plan changes and restarting cancelled subscriptions currently require billing support. Pending checkout replacement also requires support.
- Mocked transactions prove the application contract, not emulator or production Firestore concurrency. Complete webhook HTTP/signature and provider delivery tests in staging.
- Registry persistence still depends on retaining the shared volume. Graceful worker drain, distributed coordination and interrupted-job recovery are not complete.
- Storage rules/indexes were not deployed or emulator-tested. Verify real tenant journeys and supported editor export in staging.
- CI has not run remotely. Python dependency locking and Linux image validation remain outstanding. Dependency major upgrades need staging browser capture/render checks.
- Configure and test production settings, monitoring alerts, backups/restoration, rollback, capacity and provider/privacy approvals before release.
- Unused simulated overage charging is disabled explicitly; no automatic overage collection is configured. Abuse logging is not a deployed alerting system.

## Provider reference

Recurring checkout and lifecycle events follow [Paystack subscription documentation](https://docs-v2.paystack.com/docs/payments/subscriptions/). Review provider test evidence before enabling paid production subscriptions.
