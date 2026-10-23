# Deployment checklist

What still stands between KenganSocial and real users, as of 23 October 2026. The code is built and tested locally; everything below needs an account, money, an approval, or the real server. A printable version is in [KenganSocial_What_Needs_You.pdf](KenganSocial_What_Needs_You.pdf).

**Must** items block launch. **Soon** items can follow in the first weeks.

## 1. Hosting and domain

- [ ] **Must**: Re-open a Google Cloud billing account and link it to the `kengansocialv2` project (both billing accounts are currently closed).
- [ ] **Must**: Create the VM and start the stack (`docker compose up -d --build`); follow [DEPLOY.md](DEPLOY.md).
- [ ] **Must**: In GoDaddy DNS, add an `A` record for `api` pointing at the VM's IP address.
- [ ] **Must**: Choose where the web app is hosted. The Vercel project was deleted on purpose; either create a new one linked to GitHub or serve the web app from the VM. Then point `kengansocial.co.za` and `www` at it.

## 2. Payments (Payfast)

- [ ] **Must**: Open a Payfast merchant account and a sandbox account.
- [ ] **Must**: Set `PAYFAST_MODE=sandbox`, `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY` and `PAYFAST_PASSPHRASE` in `server/.env` on the VM (set the passphrase in Payfast first).
- [ ] **Must**: On the live server, subscribe with a sandbox card, confirm the plan unlocks, cancel renewal, and confirm access lasts to the end of the paid period. Payfast only confirms payments to a public HTTPS address (`/api/billing/payfast/notify`).
- [ ] **Must**: Switch to `PAYFAST_MODE=live` with live details; make one real low-value payment and refund it.
- [ ] **Soon**: Decide what happens to anyone still on Paystack. Keep `PAYSTACK_SECRET_KEY` until none remain.

## 3. Secrets and server settings

- [ ] **Must**: Replace the Firebase service-account key whose ID starts `ac504d10` (it was pasted in a chat). Delete it in Google Cloud and create a new one, or use the VM's own service account.
- [ ] **Must**: `TOKEN_ENCRYPTION_KEY`: 64 hexadecimal characters (`openssl rand -hex 32`). Never change it once accounts are connected.
- [ ] **Must**: `FREE_CLIP_SECRET`: a long random value; never change it.
- [ ] **Must**: `SERVER_URL`, `CLIENT_URL`, `FRONTEND_URL` set to the real `https://` domains (the server refuses to start in production otherwise).
- [ ] **Must**: Remove `DEV_PLAN_OVERRIDE` and set `NODE_ENV=production` (the server refuses to start with the override in production).
- [ ] **Must**: Set `META_APP_SECRET` and `META_VERIFY_TOKEN` (production refuses unsigned Meta webhooks).

## 4. Firebase

- [ ] **Must**: `firebase deploy --only firestore:rules,firestore:indexes,storage`. This adds the indexes for the calendar and the Clients feedback bell, and the 30-day clean-up of automation records.
- [ ] **Must**: Remove public access from files already in the storage bucket; the app now hands out expiring links.
- [ ] **Soon**: Delete the `@example.com` test accounts and test free-clip records.

## 5. Social platforms and AI

- [ ] **Must**: Meta app dashboard → Webhooks: subscribe Instagram `messages` and `comments`, and Page `feed`, `messages` and `message_echoes`. Instagram comment events can only be switched on there.
- [ ] **Must**: Submit the Meta app for review (Advanced Access and business verification). Notes and screencast scripts: [SOCIAL_SETUP.md](SOCIAL_SETUP.md), [API_APPLICATIONS.md](API_APPLICATIONS.md).
- [ ] **Must**: Switch off Meta Business Suite instant replies and away messages; they look like manual replies and pause automation for 12 hours.
- [ ] **Must**: TikTok and YouTube app approval (until then, posting works only for your own test accounts).
- [ ] **Must**: Add AI keys (Gemini or OpenRouter/OpenAI) for AI clip ranking, headlines and captions.
- [ ] **Soon**: ElevenLabs (voiceovers), Treblo (music) and an image generator (AI thumbnail backgrounds).

## 6. Legal and privacy (POPIA)

- [ ] **Must**: Register an Information Officer with the Information Regulator.
- [ ] **Must**: Review the updated Privacy Policy and Terms (Payfast, automatic renewal; dated 23 October 2026), ideally with someone qualified.
- [ ] **Must**: Make sure `billing@kengansocial.co.za`, `support@kengansocial.co.za` and `privacy@kengansocial.co.za` receive mail.

## 7. Before inviting real users

- [ ] **Must**: Run `node scripts/check-deploy.mjs <web-url> <api-url>` against the real domains, then test sign-up, two separate workspaces, upload, clips, scheduling, a client review link and payment.
- [ ] **Must**: Turn on scheduled Firestore exports and VM disk snapshots, then test a restore.
- [ ] **Soon**: Point an uptime monitor at `https://api.kengansocial.co.za/api/health/ready`.
- [ ] **Soon**: Keep a single API container. Scheduling and webhooks run inside it, so a second copy would double-post.

## 8. Technical work left for the live server

These need the real Linux VM to do safely; none blocks a small pilot.

- [ ] **Soon**: Run the containers as a non-root user (check volume permissions on the VM).
- [ ] **Soon**: Memory limits per container once the VM size is known (the video service and Chrome renders are the heaviest).
- [ ] **Soon**: Build both Docker images in CI (`.github/workflows/verify.yml`) and confirm the first CI run passes on GitHub.
- [ ] **Soon**: Bake the Whisper speech model into the video image, so the first transcription after a deploy doesn't download it.
- [ ] **Soon**: Error tracking and alerts (for example Sentry) beyond container logs.
- [ ] **Soon**: Email notifications to the agency when a client responds to a review link. In-app notifications already work; there is no email provider yet.
- [ ] **Soon**: Decide the font: Geist is flagged as overused by the design checker; keeping it is a brand choice.

## Done and verified locally (23 October 2026)

- Server typecheck; 38 security tests (payments, media, quotas, uploads, review links, automation, leads); 16 video-ad tests
- Client lint, typecheck and production build
- Client approval flow end to end against the API (15 checks), resumable uploads (13 checks), free clip, thumbnails
- Graceful shutdown, no double-posting, recovery after restarts, rotated logs, pinned Python dependencies
- Design checks with Impeccable: public pages clean apart from the font; landing page kept as designed
