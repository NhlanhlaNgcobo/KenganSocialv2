# Connecting your own TikTok, YouTube and Instagram/Facebook for testing

This guide gets KenganSocial posting to your own accounts from your laptop. Each platform needs a free developer app that you own. Apps stay in testing/sandbox mode, which is all you need to post to accounts you add as testers. No platform review is needed for this.

Plan for about an hour in total: around 15 minutes for YouTube, 20 for Meta and 20 for TikTok.

---

## 0. One-time: a public HTTPS address for your laptop

TikTok and Meta only redirect to `https://` addresses, and Instagram downloads your video from a public URL. A tunnel gives your local API a public HTTPS address. ngrok is already installed on this PC.

1. Create a free account at [ngrok.com](https://ngrok.com), then copy your authtoken from the dashboard.
2. In a terminal: `ngrok config add-authtoken <your-token>`
3. In the ngrok dashboard, open **Domains** and claim your free static domain, for example `kengan-yourname.ngrok-free.app`. A static domain means the redirect URIs below never change.
4. Start the tunnel whenever you test: `ngrok http --url=kengan-yourname.ngrok-free.app 5000`
5. In `server/.env`:
   ```
   SERVER_URL=https://kengan-yourname.ngrok-free.app
   STORAGE_DRIVER=local
   ```
   Restart the API. Keep `CLIENT_URL=http://localhost:5173`; you still use the app at localhost.

Below, `<SERVER>` means that `https://…ngrok-free.app` address.

---

## 1. YouTube (Google Cloud)

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a project named "KenganSocial".
2. **APIs & Services → Library**: enable **YouTube Data API v3**.
3. **APIs & Services → OAuth consent screen**:
   - User type **External**, app name "KenganSocial", support email: yours.
   - Scopes: add `youtube.upload`, `youtube.readonly` and `youtube.force-ssl`.
   - **Test users**: add the Google account that owns your YouTube channel.
   - Leave it in **Testing**. You will see an "unverified app" warning when connecting; click Continue.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type **Web application**.
   - Authorized redirect URIs: `<SERVER>/api/connections/youtube/callback`. Add `http://localhost:5000/api/connections/youtube/callback` as well, so YouTube also works without the tunnel.
5. Copy the client ID and secret into `server/.env`:
   ```
   YOUTUBE_CLIENT_ID=...
   YOUTUBE_CLIENT_SECRET=...
   ```

What to expect: uploads appear on your channel. Testing-mode tokens expire after 7 days, so reconnect weekly while testing.

---

## 2. Instagram and Facebook (Meta)

**Before you start**: your Instagram account must be a **Professional** account (Creator or Business) and linked to a **Facebook Page** you manage. In Instagram: Settings → Account type and tools → Switch to professional account. Then link it under Page settings → Linked accounts.

1. Go to [developers.facebook.com](https://developers.facebook.com) → **My Apps → Create App**. Choose use case **Other**, app type **Business**, and name it "KenganSocial".
2. Add the product **Facebook Login for Business** (or **Facebook Login**). Under its **Settings**, add all three Valid OAuth Redirect URIs:
   - `<SERVER>/api/connections/instagram/callback`
   - `<SERVER>/api/connections/facebook/callback`
   - `<SERVER>/api/connections/meta_ads/callback`
3. Add the products **Instagram** (Instagram API with Facebook Login), **Messenger** and **Marketing API**.
4. **Webhooks** (products menu): callback URL `<SERVER>/api/webhooks/meta`, verify token = `META_VERIFY_TOKEN`. Subscribe the app (this part is manual, in the dashboard):
   - object **Instagram**: `messages` (includes echoes of the account's own messages) and `comments`. Instagram comment and message webhooks are chosen **only here**: no API call can turn them on for you. In **Instagram → API setup with Facebook login → Configure webhooks**, also make sure the `comments` field is subscribed, and that the app is in **Live** mode (in Development mode Meta only delivers events for app roles).
   - object **Page**: `feed`, `messages`, `message_echoes`.
   Connecting an account then subscribes its Page automatically (`POST /{page-id}/subscribed_apps`): the fields the Page already had are kept and the ones KenganSocial needs are added (Facebook: `feed`, `messages`, `message_echoes`; Instagram: `messages`, or `name` if Meta refuses that, which is enough to install the app on the Page). The result is stored on the connection (`webhookSubscription`); if it failed, the Connections page shows a warning with a **Retry** button (`POST /api/connections/:platform/webhooks`).
5. **App settings → Basic**: copy the **App ID** and **App Secret**. Add a privacy policy URL (`http://localhost:5173/privacy` is fine while testing).
6. **App roles → Roles**: your Facebook account is already Admin. Add anyone else who will test as Tester.
7. In `server/.env`:
   ```
   FACEBOOK_APP_ID=...
   FACEBOOK_APP_SECRET=...
   META_APP_SECRET=...        # the same App Secret
   META_VERIFY_TOKEN=any-random-string-you-choose
   ```

**How automations behave** (services/meta): a rule replies to the same person at most once per 24 hours; the identical text is never sent to the same person twice within 10 minutes; automatic sends stop for the rest of the hour after 200 on one channel (Meta's Instagram limit is about 200 automated DMs an hour), and the Automations page says so; replies you send by hand are never limited this way. When the owner answers a conversation by hand (in Instagram, Messenger, Business Suite or the KenganSocial Inbox), automation pauses in that conversation for 12 hours. Meta's own "instant replies" and "away messages" in Business Suite also count as replies by hand, so turn them off if you use KenganSocial automations. A send that fails for a temporary reason is retried by the webhook worker (after 30 s, 2 min, 10 min and 1 h) without sending twice; a revoked token marks the connection Expired so Connections asks for a reconnect.

Deploy `firestore.indexes.json` (`firebase deploy --only firestore:indexes`): it includes a TTL policy on `automationRuns.expireAt`, which deletes automation run records after 30 days.

In development mode, Meta grants every permission to app roles without review. For App Review, request exactly these (the scopes in `server/src/routes/connections.ts`; the in-app explanations are in `client/src/content/platform-permissions.js`):

| Permission | Requested by | What KenganSocial does with it (show this in the screencast) |
| --- | --- | --- |
| `instagram_basic` | Instagram | Shows the connected account's username, picture and followers on Connections. |
| `instagram_content_publish` | Instagram | Publishes a scheduled Reel from the Calendar. |
| `instagram_manage_insights` | Instagram | Reach, interactions and followers on Analytics. |
| `instagram_manage_comments` | Instagram | Comments tab in the Inbox: public reply and private reply; comment keyword automations. |
| `instagram_manage_messages` | Instagram | Inbox: reply to DMs (approval queue) and DM keyword automations, within 24 hours. |
| `pages_show_list` | Instagram, Facebook | Lists your Pages to find the linked Instagram account / pick a Page. |
| `pages_read_engagement` | Instagram, Facebook | Reads the Page and its posts' engagement for Analytics. |
| `pages_manage_metadata` | Instagram, Facebook | Subscribes the Page to webhooks for new comments and messages. |
| `business_management` | Instagram, Facebook | Finds Pages and Instagram accounts owned through Business Manager. |
| `pages_manage_posts` | Facebook | Publishes a scheduled post to the Page. |
| `pages_read_user_content` | Facebook | Shows comments on the Page's posts in the Inbox. |
| `pages_manage_engagement` | Facebook | Replies to Page comments from the Inbox and automations. |
| `pages_messaging` | Facebook | Answers Messenger messages from the Inbox and automations, within 24 hours. |
| `ads_read` | Meta Ads | Meta Ads page: campaigns with spend, reach, clicks and results. |
| `ads_management` | Meta Ads | Meta Ads page: pause, resume and change a campaign's daily budget when the user clicks it. |

Messaging rules the app enforces: normal replies only within 24 hours of the person's last message; one private reply per comment, within 7 days; nothing to people who sent "stop"; AI drafts are never sent without approval and never state prices, links, dates or times.

What to expect: videos post as **Reels**. Meta downloads the video from your tunnel, so ngrok must be running when the post goes out.

---

## 3. TikTok

1. Go to [developers.tiktok.com](https://developers.tiktok.com), log in, and open **Manage apps → Connect an app**. Create a **Web** app named "KenganSocial".
2. Add the products **Login Kit** and **Content Posting API**. In Content Posting API, turn on **Direct Post**.
3. **Login Kit → Redirect URI**: `<SERVER>/api/connections/tiktok/callback`
4. Scopes: `user.info.basic` and `video.upload`. The app requests these by default (inbox mode: videos arrive in the creator's TikTok inbox to finish posting). After TikTok approves Direct Post, add the `video.publish` scope, set `TIKTOK_SCOPES=user.info.basic,video.publish` and update the TikTok text in `client/src/content/platform-permissions.js`.
5. Open the **Sandbox** tab and create a sandbox. Under **Target users**, add your TikTok account.
6. Copy the sandbox **Client key** and **Client secret** into `server/.env`:
   ```
   TIKTOK_CLIENT_KEY=...
   TIKTOK_CLIENT_SECRET=...
   ```

What to expect: until TikTok audits your app, every post is **private ("Only me")**, which is TikTok's rule for unaudited apps. You can still check that the video, caption and timing are right in the TikTok app. After the audit, set `TIKTOK_DEFAULT_PRIVACY=PUBLIC_TO_EVERYONE`.

---

## 4. Test run

1. Restart the API, and start ngrok if you are testing TikTok or Instagram.
2. In KenganSocial, open **Connections** and connect YouTube, Instagram and TikTok. Each opens the platform's sign-in; approve it, and you return to Connections with the account listed.
3. Make something to post: open **Clips**, upload a video, and on the best clip click **Schedule**.
4. In the calendar dialog, pick the three platforms, check the caption, and set a time **5 minutes from now**.
5. Watch the API window. When the time comes, the post's status in the calendar changes to **published**, or to **failed** with the reason.
6. Check each platform: a new YouTube video (or Short, if the clip is vertical and under 60 seconds), an Instagram Reel, and a private TikTok post.

## If something goes wrong

| Message | Cause | Fix |
| --- | --- | --- |
| "YouTube is not set up on the server yet" | Keys missing from `server/.env` | Add them and restart the API |
| `redirect_uri_mismatch` (Google) or "URL blocked" (Meta) | The redirect URI in the platform console doesn't match `SERVER_URL` exactly | Copy it again, with no trailing slash |
| TikTok "scope_not_authorized" | Content Posting API or Direct Post isn't added to the app | Add the product and enable Direct Post in the sandbox |
| TikTok `unaudited_client_can_only_post_to_private_accounts` | A public post from an unaudited app | Keep `TIKTOK_DEFAULT_PRIVACY` unset (private) |
| Instagram "media could not be fetched" | ngrok wasn't running, or `SERVER_URL` isn't the tunnel address | Start ngrok and restart the API |
| Instagram account not found after connecting | The Instagram account isn't Professional or isn't linked to a Page | See "Before you start" in section 2 |
| "INVALID_OAUTH_STATE" / "EXPIRED_OAUTH_STATE" | The sign-in took longer than 15 minutes, or was started from another session | Click Connect again |
