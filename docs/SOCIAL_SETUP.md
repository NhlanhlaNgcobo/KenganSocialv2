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
2. Add the product **Facebook Login for Business** (or **Facebook Login**). Under its **Settings**:
   - Valid OAuth Redirect URIs: `<SERVER>/api/connections/instagram/callback`
3. Add the product **Instagram** (Instagram API with Facebook Login).
4. **App settings → Basic**: copy the **App ID** and **App Secret**. Set the Privacy Policy URL (`<WEBSITE>/privacy`), Terms of Service URL (`<WEBSITE>/terms`) and, under **User data deletion**, the Data Deletion Callback URL `<SERVER>/api/privacy/meta/data-deletion`. Under Facebook Login settings set the Deauthorize Callback URL `<SERVER>/api/privacy/meta/deauthorize`. See docs/API_APPLICATIONS.md.
5. **App roles → Roles**: your Facebook account is already Admin. Add anyone else who will test as Tester.
6. In `server/.env`:
   ```
   FACEBOOK_APP_ID=...
   FACEBOOK_APP_SECRET=...
   META_APP_SECRET=...        # the same App Secret
   META_VERIFY_TOKEN=any-random-string-you-choose
   ```

For Instagram the app requests `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`, `instagram_manage_messages`, `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `pages_manage_metadata` and `business_management`. For a Facebook Page it requests `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` and `business_management`. In development mode, Meta grants these to app roles without review.

What to expect: videos post as **Reels**. Meta downloads the video from your tunnel, so ngrok must be running when the post goes out.

---

## 3. TikTok

1. Go to [developers.tiktok.com](https://developers.tiktok.com), log in, and open **Manage apps → Connect an app**. Create a **Web** app named "KenganSocial".
2. Add the products **Login Kit** and **Content Posting API**. In Content Posting API, turn on **Direct Post**.
3. **Login Kit → Redirect URI**: `<SERVER>/api/connections/tiktok/callback`
4. Scopes: `user.info.basic` and `video.publish`. The app requests exactly these (it posts directly, so `video.upload` is not needed).
5. Open the **Sandbox** tab and create a sandbox. Under **Target users**, add your TikTok account.
6. Copy the sandbox **Client key** and **Client secret** into `server/.env`:
   ```
   TIKTOK_CLIENT_KEY=...
   TIKTOK_CLIENT_SECRET=...
   ```

What to expect: the scheduler's TikTok settings show your account and the privacy levels TikTok allows it; you choose one on each post (there is no default, as TikTok's posting rules require). Until TikTok audits your app, only **"Only me"** works and the posting account must be private. You can still check that the video, caption and timing are right in the TikTok app.

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
| TikTok `unaudited_client_can_only_post_to_private_accounts` | A public post from an unaudited app | Choose "Only me" on the post until the app is audited |
| Instagram "media could not be fetched" | ngrok wasn't running, or `SERVER_URL` isn't the tunnel address | Start ngrok and restart the API |
| Instagram account not found after connecting | The Instagram account isn't Professional or isn't linked to a Page | See "Before you start" in section 2 |
| "INVALID_OAUTH_STATE" / "EXPIRED_OAUTH_STATE" | The sign-in took longer than 15 minutes, or was started from another session | Click Connect again |
