# Applying for Meta, TikTok and YouTube API access

What KenganSocial already does to meet each platform's review requirements, what you still need to do before applying, and what to submit. Requirements were checked against the platforms' official documentation on 20 October 2026. Re-check each platform's current review page before submitting, because they change often.

## 1. What is ready in the app

| Requirement | Where | Verified by |
|---|---|---|
| Public Terms of Service, Privacy Policy and Data Deletion page, readable without signing in or JavaScript | `/terms`, `/privacy`, `/data-deletion` (React pages, plus static HTML in `client/public/legal` and `server/public/legal` generated from `client/src/legal/legal-content.js`) | `npx tsx scripts/check-legal.mjs`, `scripts/e2e-privacy.mjs` |
| Platform clauses: YouTube Terms of Service link-and-bind, Google Privacy Policy link, Google revoke link, Limited Use statement, 30-day and 7-day YouTube rules, Meta deletion instructions, Instagram DM visibility, TikTok Music Usage Confirmation and Branded Content Policy, no affiliation with the platforms | `client/src/legal/legal-content.js` | `scripts/check-legal.mjs` (31 required clauses) |
| POPIA section 18 notice: responsible party, purposes, sources, recipients, cross-border transfers (s72), rights, Information Regulator contact, security compromise (s22), retention, automated processing, direct marketing (s69), PAIA manual reference | Privacy Policy | `scripts/check-legal.mjs` |
| Meta Data Deletion Request callback (signed_request verified with the app secret, answers `{url, confirmation_code}`) | `POST /api/privacy/meta/data-deletion` | `scripts/e2e-privacy.mjs`; forged and wrong-algorithm requests are rejected |
| Meta Deauthorize callback (connection marked revoked, tokens deleted) | `POST /api/privacy/meta/deauthorize` | `scripts/e2e-privacy.mjs` |
| Human-readable deletion status | `/data-deletion/status?code=…`, `GET /api/privacy/deletion-status/:code` | e2e and browser tests |
| Disconnect revokes at the platform and deletes the data that connection brought in | `DELETE /api/connections/:platform`: Google revoke, TikTok `/v2/oauth/revoke/`, Meta `DELETE /me/permissions` and Page webhook removal; deletes stored analytics, and DMs, opt-outs and message leads for Instagram | `scripts/e2e-privacy.mjs` |
| In-app data export and account deletion | Settings › Privacy & data | e2e and browser tests |
| YouTube: stored data refreshed or deleted within 30 days; access revoked at Google is cleaned up within 30 days | Daily analytics sync removes YouTube figures older than 30 days; the token cron deletes connections that have been revoked or expired for 30 days | code review: `analyticsService.ts` `purgePlatformAnalytics`, `connections.ts` cron |
| TikTok Direct Post screen per the Content Sharing Guidelines: creator nickname from `creator_info`, no posting when TikTok says the creator can't post, privacy dropdown with no default, interaction toggles unchecked and greyed out when disabled, commercial content disclosure with its labels, "Only me" blocked for branded content, video length check, preview, consent text above the publish button, processing notice | Scheduler › TikTok post settings (`client/src/pages/Calendar/PlatformPostSettings.tsx`) | browser test (simulated `creator_info`) |
| YouTube upload asks for visibility and "made for kids"; scheduled posts are never public unless chosen | Scheduler › YouTube post settings; `publishers/youtube.ts` | browser test |
| Disclosure before each platform sign-in (what is accessed, platform terms, how to disconnect; Instagram DM-visibility acknowledgement, Meta Developer Policies 5.8a) | Connections (`components/connections/ConnectDisclosure.jsx`) | browser test |
| Only permissions the app uses are requested | `server/src/routes/connections.ts` (Facebook trimmed to 4; `yt-analytics.readonly` added because analytics uses it) | code review |
| Homepage describes each integration; the Terms, Privacy and Data Deletion links and a contact email are in the visible footer; the app name is consistent | Landing page | browser test |
| Tokens encrypted (AES-256-GCM), connection documents closed to the browser | `utils/tokenEncryption.ts`, `firestore.rules` | code review |

## 2. Before you apply: things only you can do

1. **Company details.** Fill in `client/src/legal/company.js`: CIPC registration number, registered address, phone number, Information Officer name, and the PAIA manual URL. Then run `node scripts/build-legal.mjs`; the client build also runs it. These must match your CIPC documents exactly for Meta Business Verification. `scripts/check-legal.mjs` lists anything still missing.
2. **PAIA manual and Information Officer.** Publish a PAIA manual on the website and register the Information Officer with the Information Regulator.
3. **Production domain.** Deploy the website and API on your real domain over HTTPS:
   - Set `CLIENT_URL` and `SERVER_URL` on the API.
   - Set `VITE_API_URL` on the website.
   - The OAuth redirect URIs and Meta callbacks use `SERVER_URL`.
4. **Google Search Console.** Verify the website domain and the API domain. Google requires this for the OAuth consent screen.
5. **Mailboxes.** Make sure `privacy@`, `info@` and `billing@kengansocial.com` receive mail, because the legal pages promise replies.
6. **Platform secrets.** Set these on the API host:
   - `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` and `META_APP_SECRET` (the same secret; it verifies Meta's callbacks);
   - `META_VERIFY_TOKEN`;
   - `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET`;
   - `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET`;
   - `TOKEN_ENCRYPTION_KEY`.
7. **YouTube link import.** Keep `YOUTUBE_LINK_IMPORT` unset (off). It downloads videos with yt-dlp, which conflicts with YouTube's API Services policies on downloading content, and TikTok rejects apps that copy content from other platforms. Only switch it on with legal sign-off.
8. **AI provider tier for messages.** DM reply drafts send message text to an AI provider. Use a paid tier for that provider; Gemini's unpaid tier may use content to improve Google's products, which conflicts with Meta's rules on Platform Data.
9. **Reviewer test account.** Create a KenganSocial login for reviewers on a paid plan, so every feature under review is unlocked. Reviewers use their own Meta, TikTok and Google test accounts; never share yours.

## 3. URLs to enter in each developer console

Replace `https://www.kengansocial.com` (website) and `https://api.kengansocial.com` (API) with your real hosts.

| Setting | Value |
|---|---|
| Website / homepage | `https://www.kengansocial.com` |
| Privacy Policy | `https://www.kengansocial.com/privacy` |
| Terms of Service | `https://www.kengansocial.com/terms` |
| Meta: User data deletion › Data Deletion Callback URL | `https://api.kengansocial.com/api/privacy/meta/data-deletion` |
| Meta: Facebook Login › Deauthorize Callback URL | `https://api.kengansocial.com/api/privacy/meta/deauthorize` |
| Meta: Valid OAuth Redirect URIs | `https://api.kengansocial.com/api/connections/instagram/callback`, `…/facebook/callback` |
| Meta: Webhooks (Instagram messages) | `https://api.kengansocial.com/api/webhooks/meta` with `META_VERIFY_TOKEN` |
| TikTok: Redirect URI | `https://api.kengansocial.com/api/connections/tiktok/callback` |
| TikTok: URL / domain verification | Put the verification file in `server/public/verification/` (served at `/tiktok….txt`), or use the DNS method |
| Google: Authorized redirect URI | `https://api.kengansocial.com/api/connections/youtube/callback` |
| Google: Authorized domains | `kengansocial.com` |

## 4. Meta (Facebook Pages and Instagram)

- **App:** Business type, with Facebook Login for Business and the Instagram API (with Facebook Login).
- **Dashboard:** 1024×1024 icon with no Meta trademarks, category, a contact email you read, and the URLs from section 3.
- **Business Verification:** legal name, address, phone and website must match the CIPC registration. Have the registration certificate and a utility bill or bank letter ready. You get one week to answer follow-up questions.
- **Access Verification (Tech Provider):** needed because other businesses use the app. It requires Business Verification first.

**Permissions to request and how to show each.** Meta needs one screen recording per permission. Each recording must use an English UI, be at least 1080p, have no audio, and show the person granting the permission and then using it. Each permission also needs at least one successful API call in the last 30 days and its own written description; Meta warns not to copy and paste them.

| Permission | Why KenganSocial needs it | Recording |
|---|---|---|
| `pages_show_list` | List the person's Pages so they choose which to connect | Connections › Add › Facebook › Meta dialog showing Pages › connected card |
| `pages_read_engagement` | Read the Page's name, picture and follower count; required for publishing | Connected Page card with name and followers |
| `pages_manage_posts` | Publish the posts and videos the person creates or schedules | Scheduler › new post › Facebook › post appears on the Page |
| `business_management` | Include Pages owned through a business portfolio | Connecting a portfolio-owned Page |
| `instagram_basic` | Show the connected professional account | Connections › Instagram card |
| `instagram_content_publish` | Publish Reels the person creates or schedules | Scheduler › Instagram › Reel appears on the profile |
| `instagram_manage_insights` | Show account insights on the Analytics page | Analytics › Instagram figures |
| `instagram_manage_messages` | Read and answer DMs in the Inbox, and automated replies the person switches on | Inbox: a message arrives, the person replies, the reply appears in Instagram; Automation: a rule switched on |
| `pages_manage_metadata` | Subscribe the linked Page to message webhooks so DMs arrive | Connect Instagram, send a DM, it appears in the Inbox |

Also keep in mind:

- Messaging follows the 24-hour reply window and honours opt-outs, which the app records.
- Don't request `pages_messaging` or comment permissions; the app doesn't use them.
- After launch, complete Meta's yearly Data Use Checkup.

**Threads:** not built. Don't request Threads access until it is.

## 5. TikTok

- **Products:** Login Kit and Content Posting API (Direct Post).
- **Scopes:** `user.info.basic` and `video.publish`. Analytics needs `user.info.stats`; request it only when you build TikTok analytics.
- **Website:** must be a finished public site that describes the app, with the Terms and Privacy links visible without opening a menu. The footer satisfies this.
- **Name and icon:** the app name must match the website name (KenganSocial) and must not mention TikTok.
- **Demo videos:** record 1–5 videos (up to 50 MB each) in the sandbox. The browser address bar must show your submitted domain. Show the sign-in, then the TikTok post settings:
  - your account name;
  - choosing a privacy level (no default);
  - the comment, duet and stitch toggles;
  - the content disclosure with its "Promotional content" and "Paid partnership" labels;
  - the consent text;
  - scheduling;
  - the post appearing on TikTok after processing.
- **Disconnect:** show that disconnecting revokes access.
- **Content Posting audit:** a separate application with usage estimates.
- **Before the audit:** at most 5 users can post per day, posting accounts must be private, and posts must be "Only me".
- **Watermarks:** don't add KenganSocial branding or watermarks to videos sent to TikTok.

## 6. Google / YouTube

- **OAuth consent screen:**
  - app name KenganSocial and logo;
  - support and developer emails;
  - homepage, Privacy Policy and Terms from section 3;
  - authorized domain verified in Search Console.
- **Scopes:**

  | Scope | Why KenganSocial needs it |
  |---|---|
  | `youtube.upload` | Upload the videos the person creates or schedules |
  | `youtube.readonly` | List the channel and its uploads |
  | `youtube.force-ssl` | Read comments and delete a video when the person asks |
  | `yt-analytics.readonly` | Analytics page figures |

  Google asks why narrower scopes won't work; answer with the feature each one powers.
- **Verification demo video:** record it in English, showing the consent screen and then each scope in use in the deployed app:
  - Connections › YouTube disclosure › Google consent screen;
  - the Scheduler upload with visibility and "made for kids";
  - YouTube Studio listing videos and comments;
  - the Analytics page;
  - Disconnect.
- **Quota:** the default is 10,000 units a day; `videos.insert` and `search.list` have their own small buckets. Request more through the YouTube API Services audit and quota extension form. Be ready for compliance audits and to give YouTube a working test account.

## 7. Known gaps

- Threads, Facebook comment replies and Messenger DMs are not built. The legal pages don't claim them.
- TikTok analytics show "unavailable" because `user.info.stats` isn't requested.
- The Instagram connection uses Instagram API with Facebook Login. Meta also offers Instagram API with Instagram Login (`instagram_business_*` scopes). Moving to it is optional.
- Data deletion from backups: the policies promise backups are cleared within 30 days. If you turn on Firestore backups, set their retention to 30 days or less.

## 8. Checks to run before submitting

```
node scripts/build-legal.mjs                 # regenerate static legal pages
cd server && npx tsx ../scripts/check-legal.mjs
cd server && META_APP_SECRET=<server value> npx tsx ../scripts/e2e-privacy.mjs   # with the API running
```
