# Deploying KenganSocial

How to put KenganSocial online for testers. Allow about two hours the first time.

| Part | Folder | Runs on | Address (example) |
|---|---|---|---|
| Web app | `client/` | Vercel | `https://kengansocial.co.za` |
| API, video service, Redis, HTTPS | `server/`, `python-service/` | One Google Compute Engine VM, with `docker-compose.yml` | `https://api.kengansocial.co.za` |
| Database and sign-in | – | Firebase project `kengansocialv2` | – |

Vercel can't run the API: exports, transcription and launch videos run FFmpeg, Whisper and Chrome for minutes at a time and keep files on disk. The API and the video service also pass each other file paths, so they must share one machine.

Run one VM only. The scheduler, token refresh and webhook jobs run inside the API, so a second copy would publish posts twice.

Replace `kengansocial.co.za` with your domain throughout.

## 1. Before you start

- **Domain.** You need to be able to add DNS records for your domain.
- **Google Cloud billing.** Link a billing account to the `kengansocialv2` project (console.cloud.google.com → Billing). Compute Engine needs it.
  - This also moves Firebase to the pay-as-you-go Blaze plan. The free quotas still apply.
  - Set a budget alert under Billing → Budgets & alerts.
- **Vercel account.** Connect it to the GitHub repository.
- **gcloud CLI.** Install it on your PC and sign in: `gcloud auth login`, then `gcloud config set project kengansocialv2`.

## 2. Create the VM

Johannesburg (`africa-south1`) is next to the Firestore database and close to South African users. 4 vCPU and 16 GB is enough for a few people exporting at the same time.

```bash
gcloud services enable compute.googleapis.com
gcloud compute addresses create kengan-api-ip --region=africa-south1
gcloud compute instances create kengan-api \
  --zone=africa-south1-a --machine-type=e2-standard-4 \
  --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=100GB --boot-disk-type=pd-balanced \
  --address=kengan-api-ip --scopes=cloud-platform --tags=kengan-web
gcloud compute firewall-rules create kengan-web \
  --allow=tcp:80,tcp:443,udp:443 --target-tags=kengan-web
```

Let the VM's service account use Firestore and Firebase sign-in. No key file is needed. `PROJECT_NUMBER` is shown by `gcloud projects describe kengansocialv2`.

```bash
SA=PROJECT_NUMBER-compute@developer.gserviceaccount.com
gcloud projects add-iam-policy-binding kengansocialv2 --member=serviceAccount:$SA --role=roles/datastore.user
gcloud projects add-iam-policy-binding kengansocialv2 --member=serviceAccount:$SA --role=roles/firebaseauth.admin
```

DNS: add an `A` record for `api.kengansocial.co.za` pointing at the address from `gcloud compute addresses describe kengan-api-ip --region=africa-south1`.

## 3. Set up the VM

```bash
gcloud compute ssh kengan-api --zone=africa-south1-a
```

On the VM:

```bash
curl -fsSL https://raw.githubusercontent.com/NhlanhlaNgcobo/KenganSocialv2/main/scripts/vm-setup.sh -o vm-setup.sh
bash vm-setup.sh https://github.com/NhlanhlaNgcobo/KenganSocialv2.git main
```

If the repository is private, the clone will ask you to sign in:

1. Create a fine-grained GitHub token with read-only access to this repository.
2. Enter it as the password.
3. If the `raw.githubusercontent.com` download fails, copy `scripts/vm-setup.sh` to the VM with `gcloud compute scp` instead.

Log out and back in once, so Docker works without `sudo`.

## 4. Production settings

Edit `~/kengansocial/server/.env` with `nano`. It was copied from `.env.example`, which explains each variable. Change at least these:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `CLIENT_URL` | `https://kengansocial.co.za` |
| `CORS_EXTRA_ORIGINS` | `https://www.kengansocial.co.za` (if you use www) |
| `SERVER_URL` | `https://api.kengansocial.co.za` |
| `FRONTEND_URL` | `https://kengansocial.co.za` |
| `FIREBASE_PROJECT_ID` | `kengansocialv2` |
| `FIREBASE_SERVICE_ACCOUNT_PATH`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL` | delete these lines (the VM's account is used) |
| `STORAGE_DRIVER` | `local` (media kept on the VM disk; switch to `s3` with Backblaze B2 when you grow) |
| `TOKEN_ENCRYPTION_KEY` | `openssl rand -hex 32`. Never change it once accounts are connected. Keep a copy in a password manager. |
| AI keys | `OPENROUTER_API_KEY` and/or `GEMINI_API_KEY`. Use a paid tier for Gemini (`docs/API_APPLICATIONS.md`). |
| Platform apps | `YOUTUBE_*`, `FACEBOOK_*`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `TIKTOK_*` |
| Paystack | test keys while testing; `PAYSTACK_CALLBACK_URL=https://kengansocial.co.za/dashboard/billing` |
| `YOUTUBE_LINK_IMPORT` | leave empty (off) |

`REDIS_URL`, `PYTHON_API_URL`, `PORT` and the temp folder are set by `docker-compose.yml`, so leave them as they are.

In `~/kengansocial/python-service/.env`:

- delete the `FIREBASE_SERVICE_ACCOUNT_PATH` line;
- set `FIREBASE_PROJECT_ID=kengansocialv2`.

Start everything:

```bash
cd ~/kengansocial
echo "API_DOMAIN=api.kengansocial.co.za" > .env
docker compose up -d --build
docker compose ps
docker compose logs -f api
```

The first build takes 10–15 minutes. Once the DNS record has spread, Caddy gets the HTTPS certificate by itself. `https://api.kengansocial.co.za/api/health` should then answer `{"status":"ok",…}`.

## 5. Web app on Vercel

1. In Vercel, **Add New → Project**, then import the GitHub repository.
2. Set **Root Directory** to `client`. The framework (Vite), build command and output folder come from `client/vercel.json`.
3. Under **Environment Variables**, for Production and Preview, add these. The values are the same as in your local `client/.env`, apart from the API URL.
   - `VITE_API_URL=https://api.kengansocial.co.za/api`
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`

   The build stops with an error if `VITE_API_URL` or the Firebase values are missing, or if the API URL points at localhost.
4. Deploy. Then go to **Settings → Domains** and add `kengansocial.co.za` (and `www` if you want it). Create the DNS records Vercel shows.

## 6. Firebase

1. Go to Firebase console → Authentication → Settings → **Authorized domains**. Add `kengansocial.co.za` (and `www`, and your `*.vercel.app` address if testers will use it). Google sign-in fails on domains not on this list.
2. Deploy the Firestore rules and indexes after any change: `firebase deploy --only firestore:rules,firestore:indexes`.
3. Turn on Firestore point-in-time recovery: Firestore → Disaster recovery.

## 7. Social platforms

Enter the production URLs in each developer console. The full list is in `docs/API_APPLICATIONS.md`, section 3.

The OAuth callbacks are `https://api.kengansocial.co.za/api/connections/<platform>/callback`.

Until each platform approves the app:
- only accounts you add as testers in that platform's console can connect;
- TikTok posts stay "Only me".

## 8. Check the deployment

From your PC, in the repository:

```bash
node scripts/check-deploy.mjs https://kengansocial.co.za https://api.kengansocial.co.za
```

It checks:
- the web app, its security headers and the legal pages (static, readable without JavaScript);
- that the built app calls your API and not localhost;
- HTTPS on the API, and that CORS allows only your web app;
- that forged Meta deletion requests are refused and signed-out requests are refused.

Then sign up in the browser, accept the Terms, connect a platform and export a short video.

## 9. Inviting testers

- **Sign-up.** Testers sign up at your domain. Each one gets their own workspace on the free Starter plan.
- **Full access.** New accounts get a full-access trial automatically: the Agency plan for 30 days, then the free plan unless they upgrade. Change it with `TRIAL_PLAN` and `TRIAL_DAYS` in `server/.env` (`TRIAL_DAYS=0` turns it off). Billing shows the trial and its end date.
- **Accounts made before the trial existed, or a longer trial.** In the Firebase console, open Firestore → `workspaces` → the workspace, and set `trialPlan` (for example `agency`) and `trialEndsAt` (a date such as `2026-12-31T00:00:00Z`). Or set `plan` itself for a permanent change. `DEV_PLAN_OVERRIDE` does not work in production.
- **Connecting social accounts.** Before platform approval, add each tester's social account as a tester or developer in the platform's console; otherwise they can't connect it.

## Running it

| Task | Command (on the VM, in `~/kengansocial`) |
|---|---|
| Update to the latest code | `git pull && docker compose up -d --build` |
| Logs | `docker compose logs -f api` (or `video`, `caddy`, `redis`) |
| Restart | `docker compose restart api` |
| Disk space | `df -h` and `docker system df`. Renders and uploads older than 3 days are deleted automatically (`TEMP_RETENTION_HOURS`). |
| Back up media | snapshot the disk on a schedule: `gcloud compute resource-policies create snapshot-schedule kengan-daily --region=africa-south1 --daily-schedule --start-time=02:00 --max-retention-days=7`, then `gcloud compute disks add-resource-policies kengan-api --resource-policies=kengan-daily --zone=africa-south1-a` |

**Speed.** On the VM, a 20-second 1080p template export takes about one to three minutes, depending on its effects. Several exports at once share the 4 vCPUs. If testers wait too long, move to `e2-standard-8`:

1. Stop the VM.
2. Run `gcloud compute instances set-machine-type kengan-api --machine-type=e2-standard-8 --zone=africa-south1-a`.
3. Start the VM again.
