# Marketing → Video Ads

Creators upload up to four product photos or enter a public website URL, review the extracted offering and Brag storyboard, edit narration, choose an ElevenLabs voice and Treblo music mood, then render a 15-, 20-, or 25-second MP4. Vertical, square, and landscape exports are supported. Captions use ElevenLabs character alignment. Product photos use a dedicated product presentation rather than a browser mockup.

The existing Brag inspection/planning/rendering code is reused. Website text provides a deterministic fallback when no existing AI planning provider is configured. Creator-supplied descriptions narrow the offering so unrelated website sections cannot override it. Review extracted claims before rendering.

## Runtime

- Existing Node server, Firestore credentials and Redis connection.
- Existing Remotion/Chrome, FFmpeg and FFprobe installation.
- `ELEVENLABS_API_KEY`: secret API key, not the key ID. Needs voice listing and text-to-speech permissions.
- `TREBLO_API_KEY`: API key with generation credits.
- Set secrets in the server environment and restart the server after changing them. No client-side provider keys.
- Keep `server/.cache/video-ads` on a persistent private volume. All API/worker instances must share that volume. Do not serve this directory statically.

Both provider adapters call the official APIs. Treblo v3 accepts a length range with strictly increasing bounds in multiples of 30; the implementation requests `[0, 30]`, then loops/trims/fades the downloaded soundtrack as needed. It does not claim support for a separate Treblo sound-effects API.

The last encoding pass removes B-frame timing overshoot, trims/pads audio, and verifies the encoded container duration and presence of both audio and video. Overlong narration fails with a request to shorten the script instead of cutting off speech.

## API

All endpoints are mounted under `/api/marketing/video-ads` after the existing workspace authentication middleware.

| Method | Path | Access / behavior |
| --- | --- | --- |
| GET | `/options` | Workspace member; available voices, provider configuration, supported options |
| GET | `/` | Workspace member; up to 30 recent entries from a bounded 100-record read |
| POST | `/` | Editor+, Nano+; multipart `images`, `url`, `name`, `description`, `duration`, `format`; returns draft |
| GET | `/:id` | Same workspace; safe public job fields only |
| POST | `/:id/render` | Editor+; reviewed `script`, `voiceId`, `mood`, `music`, `captions`, `confirmed`; idempotent queue transition |
| GET | `/:id/media/video` | Same workspace; authenticated MP4 delivery |
| GET | `/:id/media/poster` | Same workspace; authenticated poster delivery |
| DELETE | `/:id` | Editor+; deletes inactive draft/export and associated private files |

## Jobs, billing and retention

- Metadata: server-only `marketing_video_ads` Firestore collection; every record has a server-derived workspace and creator.
- Brag draft planning uses one existing AI credit; generation reserves one existing render allowance.
- Redis Lua updates the monthly counter and job ledger atomically. Duplicate reservations/refunds do not change the balance twice.
- Firestore transactions prevent duplicate render submissions and competing worker claims. Queued jobs survive restarts. One job runs per process.
- The worker checks every 30 seconds; render submission also wakes it immediately. A heartbeat renews the active lease.
- Interrupted active jobs fail explicitly and refund instead of repeating paid provider calls. Failed jobs must be recreated from a new draft.
- Failed refund attempts remain marked for later retry.
- Sources, provider audio, drafts, and exports expire after 30 days; the worker removes expired inactive entries in batches. Creators can delete earlier. Active jobs and pending refunds are not swept.
- Deletion is limited to validated UUID directories beneath the private media root.

## Credentials in GitHub

Deployment credentials belong in encrypted repository Actions secrets, never Git history. `SERVER_ENV` and `CLIENT_ENV` preserve runtime configuration; `FIREBASE_SERVICE_ACCOUNT_JSON` preserves the referenced service-account credential. Separate `ELEVENLABS_API_KEY` and `TREBLO_API_KEY` secrets allow explicit deployment overrides. A deployment must restore the Firebase JSON to the path referenced by the server environment and materialize environment files securely. Adding secrets alone does not deploy the application.

## Validation

Run from `server/`:

```powershell
node --test tests/video-ads/core.test.js tests/video-ads/media.test.js tests/video-ads/drafts.test.js
npx.cmd tsx --test tests/video-ads/routes.test.ts
npx.cmd tsx --test tests/video-ads/billing.test.ts
node tests/video-ads/browser-smoke.mjs
node tests/video-ads/render-smoke.mjs
```

The route test uses an isolated in-memory Firestore substitute. The billing test uses uniquely named temporary keys on the configured Redis and removes them afterward. The browser test uses API fixtures with the actual React component. The render test uses cached live provider samples when available; otherwise it uses a test tone and omits music, without spending provider credits.

Verified during implementation:

- Fifteen tests across validation/providers, draft extraction/images/SSRF, MP4 boundaries at 15/20/25 seconds, HTTP ownership/role/idempotency, and real Redis concurrency/refunds passed.
- Actual website extraction/capture and deterministic Brag planning passed.
- Live ElevenLabs speech and Treblo generation/download passed.
- A real 25.000-second, 1080×1920 H.264/AAC export with both live audio samples passed.
- Desktop/mobile browser interaction and layout checks passed; no browser runtime errors.
- Frontend production build and targeted lint passed.
- Full server typecheck remains blocked by 23 pre-existing errors in unrelated modules; no errors remain in the new video-ad modules.

## Open-source provenance

- [Brag](https://github.com/latent-spaces/brag), MIT: existing project's inspection → storyboard → render foundation.
- [CutAgent](https://github.com/rishidandu/cutagent), MIT: evaluated product-ad alternative; not installed because it introduces fal.ai generation dependencies.
- [ElevenLabs timed speech API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps).
- [Treblo API](https://treblo.com/developers/docs).
