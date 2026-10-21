# Applying for Meta, TikTok and YouTube API access

This guide covers what KenganSocial already does to meet each platform's review requirements, what you still need to do before applying, and what to submit. Requirements were checked against the platforms' official documentation on 20 October 2026. Re-check each platform's current review page before submitting, because they change often. Developer-console setup steps are in `docs/SOCIAL_SETUP.md`.

## 1. What is ready in the app

| Requirement | Where |
|---|---|
| Public Terms of Service, Privacy Policy and Data Deletion page, readable without signing in and without JavaScript | `/terms`, `/privacy`, `/data-deletion`. Written in `client/src/content/legal.js`; `node scripts/build-legal-html.mjs` writes the static copies to `client/public/<slug>/index.html` and `server/public/legal/` |
| Consent to the current Terms and Privacy Policy versions | `/consent` (`client/src/pages/ConsentPage.jsx`); versions in `server/src/config/legal.ts` |
| Who runs the service (MiraiStack, registration number) and contact, on every public page | `components/layout/PublicFooter.jsx` |
| What each connection asks for, shown before the platform's own consent screen, kept in step with the requested scopes | `client/src/content/platform-permissions.js`, `components/connections/ConnectPermissions.jsx` |
| Meta Data Deletion Request callback (signed request checked with the app secret; answers `{url, confirmation_code}`) | `POST /api/data-deletion/meta` |
| Meta Deauthorize callback | `POST /api/data-deletion/meta/deauthorize` |
| Human-readable deletion status | `/data-deletion/status?code=KS-…` |
| Disconnect revokes access at the platform and deletes the data that connection brought in | `services/data-deletion.service.ts` `deleteConnection`. It covers the inbox, comments, threads, opt-outs, ads activity and stored analytics figures. |
| Account deletion (connections revoked, workspaces, files and sign-in deleted) | Settings › Security › Delete account; `DELETE /api/data-deletion/account` |
| Data download (POPIA right of access; tokens are never included) | Settings › Security › Download my data; `GET /api/privacy/export` |
| Expired or revoked access cleaned up | The token job deletes connections refused for 6 days (the policy promises 7). YouTube figures older than 30 days are removed from stored analytics at every daily sync. |
| TikTok Direct Post screen per TikTok's Content Sharing Guidelines | Scheduler › TikTok post settings (`pages/Calendar/PlatformPostSettings.tsx`). See the list below the table. |
| YouTube uploads ask for visibility and "made for kids"; scheduled posts are never public unless chosen | Scheduler › YouTube post settings; `services/publishers/youtube.ts` |
| Tokens refreshed before publishing and before reading analytics | `queues/postQueue.ts`, `analyticsService.ts` |
| YouTube link import (downloads with yt-dlp) is off unless `YOUTUBE_LINK_IMPORT=on` | `server/src/utils/features.ts` |

The TikTok Direct Post screen does the following:

- shows the creator's nickname from `creator_info`, and blocks posting when TikTok says the creator can't post right now;
- offers a privacy dropdown with no default;
- starts the comment, duet and stitch toggles unchecked, and greys them out when the creator has turned them off;
- includes the commercial content disclosure with its labels, and blocks "Only me" for branded content;
- checks the video length and shows a preview;
- puts the consent text above the publish button.

In inbox mode (`video.upload` only), the creator finishes the post in TikTok and the screen shows a note instead.

## 2. Before you apply: things only you can do

1. **Registered address.** Fill in `COMPANY.address` in `client/src/content/legal.js` (exactly as on the CoR 14.1), then run `node scripts/build-legal-html.mjs`. Meta Business Verification checks that the name, address, phone and website match the CIPC records.
2. **Information Officer and PAIA manual.** Register the Information Officer with the Information Regulator, and publish the PAIA manual on the website.
3. **Production domain.** Deploy the website and API on your real domain over HTTPS:
   - Set `CLIENT_URL` and `SERVER_URL` on the API.
   - Set `VITE_API_URL` on the website.
   - Check that `https://<site>/privacy`, `/terms` and `/data-deletion` load as static pages.
4. **Google Search Console.** Verify the website and API domains. Google requires this for the OAuth consent screen.
5. **Mailboxes.** Make sure `privacy@`, `support@` and `billing@kengansocial.co.za` receive mail, because the legal pages promise replies.
6. **Platform secrets.** Set the Meta, TikTok and YouTube app secrets and `TOKEN_ENCRYPTION_KEY` on the API host (see `.env.example`).
7. **YouTube link import.** Keep `YOUTUBE_LINK_IMPORT` off. Downloading YouTube videos conflicts with YouTube's API Services policies, and TikTok rejects apps that copy content from other platforms. Only switch it on with legal sign-off.
8. **AI provider tier for messages.** Inbox reply drafts send message text to an AI provider. Use a paid tier for it; unpaid tiers (for example Gemini's) may use content to improve the provider's products, which conflicts with Meta's rules on Platform Data.
9. **Reviewer test account.** Create a KenganSocial login for reviewers on a plan that unlocks every feature under review. Reviewers use their own Meta, TikTok and Google test accounts.

## 3. URLs to enter in each developer console

Replace `https://kengansocial.co.za` (website) and `https://api.kengansocial.co.za` (API) with your real hosts.

| Setting | Value |
|---|---|
| Homepage | `https://kengansocial.co.za` |
| Privacy Policy | `https://kengansocial.co.za/privacy` |
| Terms of Service | `https://kengansocial.co.za/terms` |
| Meta › User data deletion › Data Deletion Callback URL | `https://api.kengansocial.co.za/api/data-deletion/meta` |
| Meta › Facebook Login › Deauthorize Callback URL | `https://api.kengansocial.co.za/api/data-deletion/meta/deauthorize` |
| Meta › Valid OAuth Redirect URIs | `https://api.kengansocial.co.za/api/connections/{instagram,facebook,meta_ads}/callback` |
| Meta › Webhooks | `https://api.kengansocial.co.za/api/webhooks/meta` (verify token `META_VERIFY_TOKEN`) |
| TikTok › Redirect URI | `https://api.kengansocial.co.za/api/connections/tiktok/callback` |
| Google › Authorized redirect URI | `https://api.kengansocial.co.za/api/connections/youtube/callback` |

## 4. Meta

- **App:** Business type, with Facebook Login for Business, the Instagram API (with Facebook Login) and Webhooks.
- **Dashboard:** 1024×1024 icon with no Meta trademarks, category, a contact email you read, and the URLs from section 3.
- **Business Verification:** have the CoR 14.1 and a utility bill or bank letter showing the same name and address. You get one week to answer follow-up questions.
- **Access Verification (Tech Provider):** needed because other businesses use the app. It requires Business Verification first.

**Permissions.** The list is in `client/src/content/platform-permissions.js`:

| Area | Permissions |
|---|---|
| Instagram | `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`, `instagram_manage_messages`, `instagram_manage_comments`, `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `business_management` |
| Facebook Page | `pages_manage_posts`, `pages_read_user_content`, `pages_manage_engagement`, `pages_messaging`, `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `business_management` |
| Meta Ads | `ads_read`, `ads_management` |

Each permission needs:

- one screen recording (English UI, at least 1080p, no audio) showing the person granting it and then using it. Show the account picker after sign-in, publishing, the Inbox (a message arrives and the person replies within 24 hours), comment replies and comment-to-DM, and the Ads page changing a budget;
- at least one successful API call in the 30 days before you submit;
- its own written description. Meta warns not to copy and paste them.

After launch, complete Meta's yearly Data Use Checkup.

## 5. TikTok

- **Products:** Login Kit and the Content Posting API.
- **Posting mode:** until Direct Post is approved, request `video.upload` (inbox mode) and set `TIKTOK_SCOPES=user.info.basic,video.upload`. Then switch to `video.publish`.
- **Website:** must be a finished public site with Terms and Privacy visible without opening a menu. The footer satisfies this.
- **Name and icon:** the app name must be KenganSocial and must not mention TikTok.
- **Demo videos:** record 1–5 videos (up to 50 MB each) in the sandbox. The browser address bar must show your submitted domain. Show the sign-in and the TikTok post settings:
  - your account name;
  - choosing a privacy level (no default);
  - the comment, duet and stitch toggles;
  - the content disclosure with its "Promotional content" and "Paid partnership" labels;
  - the consent text;
  - scheduling;
  - the post appearing on TikTok.
- **Disconnect:** show that disconnecting revokes access.
- **Content Posting audit:** a separate application. Before the audit, at most 5 users can post per day, posting accounts must be private, and posts must be "Only me".
- **Watermarks:** don't add KenganSocial branding to videos sent to TikTok.

## 6. Google / YouTube

- **Consent screen:** app name KenganSocial and logo, support and developer emails, homepage, Privacy Policy and Terms from section 3, and authorized domains verified in Search Console.
- **Scopes:**

  | Scope | Why KenganSocial needs it |
  |---|---|
  | `youtube.upload` | Upload the videos the person schedules |
  | `youtube.readonly` | List the channel and its videos |
  | `youtube.force-ssl` | Show and answer comments, and delete a video on request |
  | `yt-analytics.readonly` | Analytics page figures |

- **Verification demo video:** record it in English, showing the consent screen and then each scope in use in the deployed app, then Disconnect.
- **Quota:** request more through the YouTube API Services audit and quota extension form. Be ready for compliance audits.

## 7. Known gaps

- Threads is not built. Don't request Threads access until it is.
- TikTok analytics need `user.info.stats`, which isn't requested yet.
- Data deletion from backups: if you turn on Firestore backups, keep their retention within what the Privacy Policy promises.
