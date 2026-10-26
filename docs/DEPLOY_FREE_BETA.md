# Free beta on Oracle Cloud (Path 1 of KenganSocial_Going_Live.pdf)

The API, video service, AI worker and Redis run with `docker-compose.yml` on one **Always Free** Oracle server in Johannesburg; the website runs on **Firebase Hosting** (free). Budget: R0 a month. Capacity: 20–50 invited testers, one video job at a time.

Steps marked **(you)** need your logins; the rest can be done together over SSH.

## 1. Oracle account and server (you)

1. Sign up at [cloud.oracle.com](https://cloud.oracle.com). Choose **South Africa Central (Johannesburg)** as the home region: Always Free resources only exist in the home region, and it keeps data in South Africa (POPIA). The card is only used for identity checks.
2. **Compute → Instances → Create instance**
   - Image: **Canonical Ubuntu 24.04** (aarch64).
   - Shape: **VM.Standard.A1.Flex** (Ampere, Always Free), as many OCPUs and GB as the free allowance offers (2 OCPU / 12 GB after the June 2026 change).
   - Networking: the default VCN with a public subnet; **assign a public IPv4 address**.
   - Boot volume: 100 GB (Always Free covers up to 200 GB of block storage in total).
   - SSH key: upload your public key (or let Oracle generate one and keep the private key safe).
   - If Johannesburg says "Out of host capacity", retry later; A1 capacity frees up through the day.
3. **Open ports 80 and 443**: Networking → Virtual cloud networks → your VCN → Security lists → Default → Add ingress rules: source `0.0.0.0/0`, TCP, destination ports `80` and `443`.
4. Reserve the public IP (Networking → IP management → Reserved public IPs) so it never changes.

You don't need Oracle's API Gateway: Caddy in `docker-compose.yml` already handles HTTPS in front of the API.

## 2. Prepare the server (over SSH)

```bash
ssh ubuntu@<public-ip>
# Oracle's Ubuntu images block web traffic in iptables even when the security list allows it:
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu && exit   # log in again so the group applies
# 4 GB swap: image builds on 2 cores need headroom
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
git clone https://github.com/NhlanhlaNgcobo/KenganSocialv2.git ~/kengansocial
```

## 3. Settings

- `~/kengansocial/server/.env`: start from `server/.env.example`, then add everything in `deploy/free-beta.env.example` (beta plan, free AI, local transcription, no paid keys).
  - **Firebase on Oracle:** there is no Google service account on this server, so set `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` from a **new** service-account key (delete the old key starting `ac504d10` first). Never commit this file.
  - `SERVER_URL=https://api.kengansocial.co.za`, `CLIENT_URL` and `FRONTEND_URL=https://kengansocial.co.za`, a new `TOKEN_ENCRYPTION_KEY` (`openssl rand -hex 32`) and `FREE_CLIP_SECRET`.
  - (you) `GEMINI_API_KEY` from Google AI Studio, `POLLINATIONS_API_KEY` from enter.pollinations.ai and `PEXELS_API_KEY` from pexels.com/api: all free.
- `~/kengansocial/python-service/.env`: from `python-service/.env.example`.
- `~/kengansocial/.env`: `API_DOMAIN=api.kengansocial.co.za`.

## 4. Start it

```bash
cd ~/kengansocial
docker compose up -d --build        # first build: 20–40 minutes on 2 ARM cores
docker compose logs -f api          # look for "[AI] Optional AI features on: none"
```

**(you)** In GoDaddy DNS add an `A` record: `api` → the reserved public IP. Once it resolves, Caddy fetches the HTTPS certificate by itself. Check `https://api.kengansocial.co.za/api/health/ready`: every dependency should say `ready`.

## 5. Website on Firebase Hosting (free)

```bash
# on your computer, in the project folder
echo VITE_API_URL=https://api.kengansocial.co.za/api >> client/.env.production
npm --prefix client run build
npx firebase-tools login                                   # (you)
npx firebase-tools deploy --only hosting,firestore:rules,firestore:indexes
```

**(you)** Firebase console → Hosting → Add custom domain `kengansocial.co.za` (and `www`), then add the records it shows in GoDaddy DNS. Remove the old Vercel records if any are left.

## 6. Before inviting testers

- Run `node scripts/check-deploy.mjs https://kengansocial.co.za https://api.kengansocial.co.za`.
- Sign up as a new user: Billing should say **Beta**; try a clip from a 5-minute video, an export and a lyric video with pasted lyrics.
- Oracle: Storage → Block volumes → boot volume → assign a weekly backup policy (Always Free includes 5 backups). Before big changes, export Firestore manually.
- The rest of the free checklist (Information Officer, support mailboxes, YouTube/LinkedIn test apps, key rotation) is in `docs/KenganSocial_Going_Live.pdf`.

## Updating later

```bash
cd ~/kengansocial && git pull && docker compose up -d --build
```
