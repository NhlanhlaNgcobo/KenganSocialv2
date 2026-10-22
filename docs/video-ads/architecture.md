# Marketing Video Ads

## Folder architecture

```text
client/src/pages/Marketing/
  VideoAdStudio.jsx
  VideoAdStudio.css
client/src/lib/marketing-api.js
server/src/routes/marketing-video-ads.ts
server/src/services/video-ads/
  validation.js
  drafts.js
  providers.js
  media.js
  pipeline.js
  jobs.ts
server/src/remotion/launch/parts/AdCaptions.jsx
server/tests/video-ads/
docs/video-ads/
server/.cache/video-ads/       # private, ignored; persistent shared volume in deployment
```

The existing React/Express/Firestore structure is retained instead of introducing a second Next.js/Supabase application. Directory creation precedes implementation.

## Layers

- Infrastructure: existing Firestore, Redis plan allowances, private persistent disk, FFmpeg and Remotion.
- Backend: input validation, Brag website inspection/storyboarding, audio adapters, render pipeline, persistent job records.
- API: workspace/editor authorization, bounded image uploads, draft review, generation, status, authorized media download and deletion.
- Frontend: Marketing → Video Ads; source → editable script/settings → generation → preview/download.
- Automation: durable Firestore queue with transactional claims; one active render per server. Provider task IDs and completed audio are checkpointed. Ambiguous provider submission failures are not automatically retried.
- Billing: existing render allowance; duplicate submission protection; failure refunds.
- Security: secrets only in ignored server environment, SSRF checks, decoded/re-encoded images, server-derived tenant scope, private output paths, no raw provider error bodies.

## Sources

- https://github.com/latent-spaces/brag — MIT; existing Brag-inspired code remains the foundation.
- https://github.com/rishidandu/cutagent — MIT; evaluated as an alternative, not installed (requires fal.ai).
- https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps
- https://treblo.com/developers/docs

No additional video-generation provider is required. Product images are animated, not transformed into synthetic product footage.
