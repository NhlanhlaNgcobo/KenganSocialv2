# Video Ads security checks

- [x] Existing verified Firebase session and workspace membership middleware wraps every route.
- [x] Owner/admin/editor checks protect mutations; viewers can only read workspace content.
- [x] Every draft, status request, deletion and download checks server-side workspace ownership.
- [x] Firestore client rules deny direct access; all writes use the authenticated API.
- [x] Provider keys stay in ignored server environment files / encrypted deployment secrets.
- [x] API responses exclude provider headers, raw upstream errors, file paths and billing ledgers.
- [x] Website reads reuse Brag public-address/redirect/subresource checks.
- [x] Uploads are limited to four images, 8 MB each, and decoded/re-encoded with a pixel limit.
- [x] Plain-text fields are bounded; React renders text without raw HTML injection.
- [x] Requests use bearer authentication rather than ambient session cookies; workspace header alone grants no access.
- [x] Existing server security headers and plan rate limiting apply.
- [x] Atomic billing reservation/refund ledger and transactional queue claims.
- [x] Authenticated, private media responses; no public file URLs for ads.
- [x] Explicit failure states; no silent fallback to a different paid audio provider.
- [x] Final duration and audio/video verification.
- [x] Creator deletion and 30-day inactive-asset retention.

POPIA handling: the creator interface explains processing and retention. Only required narration goes to ElevenLabs; Treblo receives a generic music mood, not customer/product records. Existing AI planning may process source text/images. Operators remain responsible for provider agreements, lawful processing, and cross-border transfer arrangements. This feature does not certify organization-wide compliance.

Operational requirements: persistent shared private storage for multiple instances; restrictive filesystem permissions; HTTPS at the existing reverse proxy; Firestore and Redis availability. No new public storage bucket is needed.
