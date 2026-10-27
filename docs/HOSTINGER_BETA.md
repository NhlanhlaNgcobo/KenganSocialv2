# Hostinger backend / Vercel frontend pilot

Updated: 2026-10-27 (Africa/Johannesburg)

## Deployed backend

- VPS: 2017652, 187.7.28.20 (2 CPUs, 8 GB RAM, 100 GB disk).
- Release directory: /opt/kengansocial-beta/releases/20261026-pilot.
- Compose project: kengansocial-beta; API, AI worker, video service and private Redis are running.
- Existing n8n applications were not restarted or modified.
- Backend hostname: https://api.kengansocial.co.za. Frontend: https://kengansocial.co.za on Vercel, which the user will deploy.
- Hostinger's existing Traefik terminates TLS and routes the API subdomain. No new service ports are published on the host.
- Total container memory caps: 4.25 GiB. Python video concurrency is one; API/worker operations may overlap. Five-user processing capacity has not been load-tested.
- Application secrets and invitation list were uploaded only after explicit user approval; stored under the private release directory, with credential files restricted to mode 600.

## Verified

- Docker Compose validation and both image builds passed.
- Python image and CI now use Python 3.13, matching the tested local runtime. The previous Python 3.11 image could not install pinned NumPy 2.5.4.
- Zod override 4.6.7 resolves the memory-exhaustion advisory reported during image build. npm audit reported zero vulnerabilities after the patch.
- 53 security tests passed; all 16 video-ad tests passed with FFmpeg available.
- Three Python tests passed inside the production image.
- Production frontend build passed using https://api.kengansocial.co.za/api.
- On the VPS, API readiness reported Redis, AI worker, Firestore and video ready.
- Protected profile and anonymous-processing routes returned 401 without sign-in. Forged private-media link returned 403. Approved frontend CORS allowed; foreign origin rejected.
- Five concurrent health requests completed in 12 ms. This is a reachability check, not evidence of five simultaneous video jobs.
- A synthetic three-second clip rendered on the VPS in 2.25 seconds, retaining audio and 640x360 video. The smoke test bypassed customer database writes and cloud uploads and cleaned up its fixture.
- No local API process was running at cutover, preventing duplicate local/production schedulers.
- Direct HTTP request to the VPS with the API Host header returned the expected HTTPS redirect (301).

## Pending public release

1. In GoDaddy, add A record `api` -> `187.7.28.20`. It still did not resolve at the latest check. Leave root/@, www and mail records unchanged; root/www belong to Vercel.
2. Deploy current frontend changes to Vercel using root directory `client`, Vite, `npm run build`, output `dist`. Import `output/vercel-beta.env` into Production and redeploy. See docs/VERCEL_HOSTINGER.md.
3. After DNS propagates, verify a trusted TLS certificate, public /api/health/ready, invited Google sign-in, upload/export/download across Vercel and Hostinger, and restart persistence/backups before inviting testers.
4. SSH is intermittently timing out despite successful deployments and checks. The optional transcription-model warm-up was not executed because SSH timed out; the first transcription may download the base model.

## Access and limitations

- Five approved Gmail addresses are stored in ignored deploy/hostinger/pilot-access.json, mounted read-only. They are not in the client bundle or git.
- Pilot API access requires a verified invited Firebase identity and rejects revoked tokens. Use Google sign-in. An uninvited account sees the private-beta explanation and sign-out action.
- Signed private media, readiness and feature flags remain reachable through their existing protections. Other routes require the pilot token, including public free-clip processing, unauthenticated reviews and social callbacks. Social integrations and external review links are not ready for this pilot.
- Firebase authorized domains includes kengansocial.co.za. Arbitrary Vercel preview domains remain unauthorized.
- Payments and paid optional AI providers are disabled. META_APP_SECRET, PEXELS_API_KEY and POLLINATIONS_API_KEY are absent; dependent features remain unavailable.
- Firebase IAM key listing returned 403, so the older deployment-checklist key-rotation warning has not been independently cleared. No keys were rotated or revoked.
- No invitation emails were sent. No git commit or push was performed; unrelated local user changes remain intact.

## Operations

From the release directory:

```sh
docker compose --env-file .env -f deploy/hostinger/compose.yml ps
docker compose --env-file .env -f deploy/hostinger/compose.yml logs --tail 100 api video ai-worker
```

Use this Compose file only. The root docker-compose.yml starts Caddy and would conflict with the existing Traefik ports. Never print the resolved environment or secret files when diagnosing issues.

## Public HTTPS verification — 2026-10-27

The API A record now resolves to 187.7.28.20. Restarted only the beta API to retry the earlier certificate request that failed before DNS existed. Trusted HTTPS verification passed without bypassing certificate checks: https://api.kengansocial.co.za/api/health/ready returned HTTP 200 with Redis, AI worker, Firestore and video all ready. DNS and API TLS are no longer pending. Vercel deployment and end-to-end invited-user checks remain outstanding.
