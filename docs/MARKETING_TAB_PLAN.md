# Marketing tab — research findings and design

Status (15 October 2026): plan approved. **Phase 1 (Brand) and Phase 2 (carousel studio) are built**, plus **Set up from website**. Phases 3–6 are next.

**Change: Higgsfield is out for now** (no account). Free AI images come from **Pollinations** (open source, MIT; free key) running open models such as FLUX.2 klein 4B (Apache-2.0). The "best quality" tier uses GPT Image 2.5 Flare via OpenRouter when that key is set. Section 1.5 still describes Higgsfield for later.

**Set up from website:** one paste reads the site the way the Launch video does (copy + screenshots), then fills the brand kit (empty fields only), learns the brand voice from the site copy, builds a business profile (what they sell, audience, offers, selling points) and keeps the site text for carousels.

**Phase 2 delivered:** slide planner (AI, brand voice + business profile), 9 HTML templates rendered to PNG with the exact brand kit (fonts embedded, no network), optional AI imagery (none / free / best), per-slide editing and image regeneration, caption + hashtags, downloads. Code: `server/src/routes/marketing-carousels.ts`, `server/src/services/marketing/carousel-*.js`, `image-gen.js`, `fonts.js`; `client/src/pages/Marketing/CarouselStudio.jsx`, `WebsiteSetup.jsx`, `BusinessProfilePanel.jsx`. Not yet: publishing carousels straight to Instagram/TikTok/LinkedIn (download and post, or use the calendar).

Phase 1 delivered:
- **Tab and nav:** `/dashboard/marketing`, under the sidebar group "Grow", with six section tabs.
- **Brand kit:** name, tagline, website, main and on-dark logos (stored as PNG), five colour roles with a contrast check, and heading/body fonts.
- **Import from website:** logo candidates, palette, fonts and social profiles, which the user reviews before saving.
- **Brand voice:** learned from samples, with an editable profile.
- **Reference library:** up to 50 images, with AI tags and a style profile.
- **Live brand preview and a completeness checklist.**
- **Code:**
  - Server: `server/src/routes/marketing.ts`, `server/src/services/marketing/brand-extract.js`, `brand-ai.js`
  - Client: `client/src/pages/Marketing/*`, `client/src/lib/marketing-api.js`

The Marketing tab is where a business (or an agency, per client workspace) keeps its brand, learns what works for its competitors, checks its website, sees its paid ads, and makes on-brand marketing content from all of that. Each section feeds the others: the brand kit styles every carousel, competitor and website findings become content ideas, and ad results show what to make more of.

---

## 1. What the research found

### 1.1 Brand kit and AI carousels

- **Leading tools (Canva, Adobe Express, PostNitro, AdCreative.ai) all use brand kits plus templates.** AI writes the copy and supplies imagery; slide text is rendered by templates, not by image models. Image models still misspell and misplace text, and colours drift slide to slide.
- **Recommended: hybrid rendering.**
  - **Templates (HTML/CSS → PNG via Puppeteer, already in the server)** render all text, the exact logo, brand hex colours and real fonts. Text is always correct and editable, renders in under a second per slide, at near-zero cost.
  - **An AI image model generates only text-free imagery** (backgrounds, product scenes, illustrations), conditioned on the user's reference images.
  - **Cost:** about **$0.05–0.15 per 8-slide carousel**, versus $0.27–1.10 for fully AI-generated slides.
- **"Learn from my reference folder"** is made real in three cheap steps:
  1. **Style profile:** a vision model reads the uploaded images once and writes a structured profile (palette, typography style, composition, imagery type, mood, recurring layouts, do/don't). Under $0.01 per batch.
  2. **Best-match references:** each image gets an embedding, and the 2–3 most relevant references are passed to the image model for each carousel.
  3. **Brand kit wins:** the explicit brand kit always overrides the style profile on colours, fonts and logo.
- **Image generation uses two providers, OpenRouter and Higgsfield, behind one adapter.** By default it uses the best image model available; section 1.5 has the details.
- **Brand voice:** extracted from 3–10 sample posts into rules (attributes with "not" pairs, tone dimensions, words to use/avoid, emoji and CTA policy) and applied to every piece of copy.
- **Publishing:**
  - **Instagram:** carousels of up to 10 JPEGs; all slides take the first slide's ratio. Use 1080×1350 (4:5) or 1080×1080.
  - **TikTok:** photo posts of up to 35 images. The image domain must be verified, and posts stay private until TikTok audits the app.
  - **LinkedIn:** document (PDF) posts.

### 1.2 Competitor intelligence ("what's working for similar brands")

| Source | What it gives | Verdict |
|---|---|---|
| **Instagram Business Discovery** (official API) | Any public Business/Creator account: followers, post count, recent posts with likes, comments, views, captions, dates | **Core of v1.** Uses the user's existing Instagram (Facebook Login) connection |
| **YouTube Data API** | Public channel and video stats | v1, with Google's rules: show current values only, refresh within 30 days, no blended cross-channel scores |
| **AI web research** (Gemini grounded search / OpenRouter web search) | Competitor positioning, offers, pricing, tone and content themes from their public website and press | v1. A few cents per report |
| **Meta Ad Library API** | Outside the EU: political/issue ads only. **No South African commercial ads** | No. Deep-link to the public Ad Library filtered to the competitor and ZA instead |
| **TikTok Creative Center / Google Ads Transparency** | Public dashboards, no usable API | Deep links only |
| **TikTok competitor stats** | No official API | Not possible legitimately |
| Scraping ad libraries (Apify etc.) | Works but breaches Meta's terms | **No** |
| Similarweb / Semrush / social listening | Licensed data | Too expensive now (thousands of dollars a year) |

Most-used features in tools like Sprout, Metricool, Foreplay and Motion, in priority order:
1. Side-by-side benchmark
2. Competitors' top posts
3. Posting cadence and format mix
4. AI theme analysis
5. Ad swipe file
6. "What are they testing" summary
7. Gap analysis
8. Exportable report

### 1.3 Website insights from a pasted URL

- **Free Google APIs** give the core scores:
  - **PageSpeed Insights:** Lighthouse Performance/SEO/Accessibility/Best-practices, mobile and desktop.
  - **CrUX:** real-visitor Core Web Vitals. Small SA sites often have too little traffic and get "no data"; the UI must handle that. Google is moving real-user data out of PageSpeed into CrUX, so call both.
- **Our own crawler** (the Puppeteer website inspector the Launch video feature already has) adds:
  - an SEO checklist
  - social profiles found
  - tech stack (open-source fingerprints)
  - broken links
  - an auto-extracted **brand kit** (logo, colours, fonts)
- **AI turns findings into a "top 5 actions" list.** Every action cites the finding it comes from, so numbers can't be invented. Actions link to the KenganSocial feature that fixes them.
- **Owner-connected data** (Google Analytics 4 and Search Console via Google sign-in):
  - Works now for up to 100 test users, but their logins expire after 7 days in testing mode.
  - Real customers need Google's app verification, so start that early.
- **Traffic estimates for other sites** (Similarweb/Semrush) are sales-led contracts. Not for now.
- **Clearbit's logo API shut down (Dec 2025).** Use our own extraction. Brandfetch is a later fallback, subject to its redistribution terms.

### 1.4 Paid ads: Meta and TikTok

**Meta Marketing API** (current version v26.0):
- **Read-only performance:** `ads_read` plus the Insights API, giving spend, impressions, reach, clicks, CTR, CPC, CPM, results, ROAS by campaign/ad set/ad, with breakdowns and daily trends.
- **What works before Meta's review:** on the default "Limited" tier, we can read ad accounts of people who have a role on our Meta app (you and your team). There's also a **sandbox ad account** with mock data.
- **What real customers need:** **Business Verification + App Review** ("Full" tier). Before applying, the app needs 500 successful API calls in 15 days. Review typically takes 2–3 days, sometimes weeks.
- **Production tokens:** Facebook Login for Business gives a "business system user" token that doesn't expire, which suits nightly syncing.

**TikTok API for Business:**
- **A separate developer portal and app** (business-api.tiktok.com), not the TikTok app we use for posting. Our `TIKTOK_CLIENT_KEY` won't work here.
- **Registration:**
  - needs a **company-domain email** and a matching public company website
  - personal developers are refused
  - app review takes 2–3 business days
- **Token and reporting:** advertiser tokens don't expire. Reporting gives spend, impressions, reach, clicks, CTR, CPC, CPM, conversions and cost per conversion.
- **Sandbox:** one sandbox ad account with mock data (fixed December 2020 dates).
- **South Africa:** supported with ZAR accounts, but some SA advertisers are billed in USD. Always display the account's own currency.

Managing ads (creating or editing campaigns) needs extra permissions and is a **later phase**. v1 is read-only performance.

### 1.5 Image generation: OpenRouter + Higgsfield, best model by default

**Which model is best right now (checked 15 Oct 2026):**
- OpenAI's GPT Image line leads the blind-vote leaderboards.
  - **GPT Image 2.5 Flare** is #1 on the most recent arena (BudgetPixel, 12 Oct 2026), ahead of GPT Image 2.5 Sunburst and GPT Image 2.
  - **GPT Image 2** leads arena.ai's text-to-image and image-edit boards in their latest snapshot (July 2026).
  - Google's Nano Banana Pro and Nano Banana 2 sit just behind on image editing.
- Rankings move every few weeks, so the model choice is configuration, not code (see "How we stay on the best model" below).

**OpenRouter** (`OPENROUTER_API_KEY`, the same key as for text):
- One Images API (`POST /api/v1/images`) covers 57 image models, with `input_references`, aspect ratio, resolution and quality.
- `openai/gpt-image-2.5-flare`:
  - Takes up to 16 reference images.
  - Aspect ratios 1:1, 2:3, 3:4, 9:16 and others; quality up to "max".
  - **No native 4:5**, so for Instagram we generate 3:4 and crop.
  - **Default for carousel imagery and hero visuals.**
  - Roughly $0.04 (medium) to $0.17 (high) per portrait image, plus reference-image input tokens.
- `google/gemini-nano-banana-2.1`:
  - Takes up to 14 references, supports **native 4:5**, 1K–4K.
  - About $0.034/image.
  - **Fast/cheap tier** (drafts, many variations, image edits that keep a product consistent).
- Also available: `google/gemini-3-pro-image` (Nano Banana Pro), `recraft/recraft-v4.1*`, `black-forest-labs/flux-3-image`, `bytedance-seed/seedream-5-0-pro` and `microsoft/mai-image-2.6`.

**Higgsfield API** (`api.higgsfield.ai`):
- **Account and keys:**
  - A separate developer account at console.higgsfield.ai.
  - Key ID + secret, sent as `Authorization: Key <id>:<secret>`.
  - Pay-as-you-go USD balance ($5 minimum, funds expire after a year); failed generations are refunded.
- **How it runs:**
  - Asynchronous: submit, get a `request_id`, then poll `status_url` or receive a webhook.
  - Outputs are kept only 7 days, so **we copy every result into our own storage**.
  - Commercial use of outputs is allowed.
- **Its catalogue complements OpenRouter rather than duplicating it** (GPT Image and Nano Banana aren't listed as separate models there):
  - **Ads Studio:** 1–8 ad concepts from optional product reference photos, rendered with GPT Image 2.5 Flare. **Used for paid-ad creatives** (Ads section and "make my version" of a competitor ad).
  - **Recraft V4.1 / Pro:** explicit RGB palette and background controls, so images come out in the exact brand colours. **Used for illustration and graphic brands.**
  - **Soul 2 / Soul Cinema:** photoreal people, fashion and editorial imagery, from about $0.003/image. **Used for lifestyle and people shots.**
  - **Ideogram 4.0:** strongest text-in-image. Only used when the user explicitly wants AI-drawn typography; normal slide text stays template-rendered.
  - **Grok Image 2.0:** up to 10 references. Kept as an alternative.
  - **Marketing Studio Image:** generate/edit campaign images.
  - **Video models** (Kling, Seedance and others) for short video ads in a later phase.

**How the adapter routes a request:**

| Job | Provider · model |
|---|---|
| Carousel imagery, hero visuals (default) | OpenRouter · `openai/gpt-image-2.5-flare` |
| Drafts, many variations, product-consistent edits | OpenRouter · `google/gemini-nano-banana-2.1` |
| Ad creatives from product photos | Higgsfield · Ads Studio |
| Brand-colour-locked illustration/graphics | Higgsfield · Recraft V4.1 (Pro) |
| Lifestyle / people photography | Higgsfield · Soul 2 |
| Fallback if a provider fails or isn't configured | the other provider's equivalent tier |

- **The user picks a style, not a model.** Choices are "Best quality", "Fast draft", "Ad concept", "Brand illustration" and "Lifestyle photo"; an "Advanced" menu allows a specific model.
- The 2–3 best-matching reference images and the brand palette go with every request.
- Every image is copied into our storage and recorded against the carousel or ad, with model, cost and prompt for traceability.

**How we stay on the best model:**
- The routing table lives in one config file, with env overrides (`IMAGE_MODEL_BEST`, `IMAGE_MODEL_FAST`, …), so switching to a newer #1 is a one-line change.
- A monthly check compares the OpenRouter and Higgsfield catalogues against the public leaderboards and updates the defaults.
- OpenRouter's `GET /api/v1/images/models` is read at startup, so a model that disappears falls back automatically instead of failing.

**Replaces the fake image generator:** the AI writer's existing "generate image" (which returns random stock photos) moves to this adapter too.

---

## 2. The tab

Route `/dashboard/marketing`, in a new sidebar group **Grow** (placed above "Results"). It uses the existing page shell (`page-head`, `.surface` cards, `.segmented` tabs, `.chip`, `.field`, recharts) and theme tokens, so it matches light and dark mode. Brand colours appear only in previews of the user's own content, never in the app's chrome.

Six sections, as segmented tabs:

### Overview (landing)
- **Brand health strip:**
  - brand kit completeness
  - website score
  - competitor count
  - ad spend and ROAS (last 7/30 days)
- **"What to do this week":** the top 5 actions merged from website findings, competitor gaps and ad results. Each has a one-click route to the feature that does it, e.g. "Competitors' carousels get 2.3× your engagement → Create a carousel".
- **Recent carousels and the latest competitor highlights.**

### Brand
- **Brand kit:**
  - logo (light and dark variants)
  - colours with roles (primary, secondary, accent, background, text) and a contrast check
  - heading and body fonts (Google Fonts, or uploaded files)
  - tagline
  - "Import from my website": one click fills all of this from the site
- **Brand voice:**
  - paste sample posts and get an editable voice profile (attributes, tone sliders, words to use/avoid, emoji and CTA style)
  - this voice is used everywhere the app writes copy
- **Reference library:**
  - a folder grid of uploaded images (up to 50 in v1), with drag-and-drop, AI tags and delete
  - a "Style profile" card shows what the AI learned (palette, layouts, mood) and can be corrected

### Create (carousel studio)
- **Input:** a brief (topic, link, a Repurpose source, or a suggested action), plus goal, platform (IG 4:5 / 1:1, LinkedIn PDF, TikTok photo), slide count and whether to use AI imagery.
- **Process:** the AI plans the slides in the brand voice, picks layouts that match the style profile, and generates 0–3 images from the best-matching references. Templates then render the slides with the exact brand kit.
- **Editor:** slide strip plus a large preview. Users edit text inline, swap layouts or regenerate an image; only the changed slide re-renders, at no AI cost.
- **Output:** caption and hashtags. Download as PNG/JPEG/PDF, or **schedule** through the existing calendar (Instagram carousel publishing is added to the publisher).

### Competitors
- **Add competitors:** name, Instagram username, YouTube channel, website, and optional TikTok/Facebook links.
- **Benchmark table:** you vs them on followers, growth, posts per week, format mix and average engagement per post (Instagram), plus current YouTube stats.
- **Their top posts this month:** ranked, with "make my version" sending the idea to Create.
- **AI briefs:** a positioning brief (offers, prices, tone, content themes) and a "gaps and opportunities" summary.
- **Ad research:** one-click links to their ads in Meta Ad Library (ZA), Google Ads Transparency and TikTok Creative Center. A **swipe file** board where users save ads they like (screenshot or link plus notes).
- **Data refresh:** daily snapshots, and a weekly "what's working" digest.

### Website
- **Input:** paste a URL (prefilled from the brand kit), then Run audit. It runs in the background and shows progress.
- **Results:**
  - score cards (mobile and desktop)
  - Core Web Vitals (real-visitor data where Google has it, lab otherwise)
  - SEO checklist
  - social profiles found, with "Connect" buttons
  - tech stack chips and broken links
  - AI top-5 actions
  - history for trends
- **Later:** "Connect Google Analytics / Search Console" for traffic, top pages and search queries.

### Ads
- **Connect Meta Ads / Connect TikTok Ads:** these are separate from the posting connections, so existing users aren't re-asked for permissions. Then pick ad accounts.
- **Overview:** spend, results, cost per result, ROAS, CTR, CPM, with a 7/30/90-day trend.
- **Campaign table:** sortable, with creative thumbnails.
- **"Best ads" gallery and an AI read-out:** what's working, what to pause, what to make next, linking to Create.
- **Data source:** a nightly sync caches results so pages stay fast and inside API limits. Every view shows the account's own currency.

---

## 3. Build order

Each phase is usable on its own and can be tested before the next starts.

| Phase | Scope | Blocked by external approval? | Rough effort |
|---|---|---|---|
| **1. Foundation + Brand** | Sidebar/route/page shell; brand kit (manual + import from website); brand voice; reference library with style profile; Firestore model + rules; plan limits | No | 3–4 days |
| **2. Create (carousels)** | Slide planner, 8–10 templates, Puppeteer renderer, AI imagery adapter (OpenRouter images), editor, downloads, Instagram carousel publishing + calendar hand-off | No (needs an AI key) | 5–7 days |
| **3. Website** | Audit job (crawler, PageSpeed, CrUX, SEO/tech/links rules), AI actions, history | No (free Google API key) | 3–4 days |
| **4. Competitors** | Registry, Instagram Business Discovery snapshots, YouTube stats, AI briefs, deep links, swipe file, weekly digest | Works now with your own Instagram connection; external users need Meta App Review (already needed for publishing) | 4–5 days |
| **5. Ads** | Meta ads connection + Insights sync + dashboards; TikTok ads connection + reporting; AI read-out | Meta: works for app-role users and sandbox now, customers after Business Verification + App Review. TikTok: business developer approval (2–3 days) | 5–7 days |
| **6. Overview + digest** | Merged "what to do this week", weekly digest | No | 2 days |
| Later | GA4/Search Console (Google verification), ad management (create/edit), LinkedIn PDF + TikTok photo publishing, Shopify/WooCommerce, licensed competitor ad data | — | — |

---

## 4. What you need to start testing

**Phases 1–3 (no approvals needed):**
1. **`OPENROUTER_API_KEY`** in `server/.env`. It covers text, vision and images (GPT Image 2.5 Flare, Nano Banana 2.1).
   - Make sure the OpenRouter account has credit.
   - OpenAI image models on OpenRouter may require OpenAI's organisation verification ("bring your own key") at times; we'll see it on the first test call.
2. **Higgsfield API keys:**
   - Create a developer account at console.higgsfield.ai (separate from the Higgsfield web app) and top up at least $5.
   - Create a key and put **`HIGGSFIELD_API_KEY_ID`** and **`HIGGSFIELD_API_KEY_SECRET`** in `server/.env`.
   - The full secret is shown only once.
3. A Google Cloud API key with **PageSpeed Insights API** and **Chrome UX Report API** enabled. Create it in project `kengansocialv2`; I can enable the APIs with the CLI.
4. Durable media storage before testers use it: Backblaze B2 (`STORAGE_DRIVER=s3`) or Firebase Storage (Blaze plan). Local disk is fine on this PC.

**Phase 4 (competitors):**
- Your Instagram Business/Creator account connected through the Meta app (the same setup as publishing in `docs/SOCIAL_SETUP.md`).
- The YouTube Data API is already enabled in `kengansocialv2`; it needs an API key.

**Phase 5 (ads):**
- **Meta:**
  1. In the existing Meta app (or a new Business-type app), add the use case "Measure ad performance data with Marketing API".
  2. Make sure you are admin on a real ad account, and create the sandbox ad account under Marketing API → Tools.
  3. Create a "Facebook Login for Business" configuration with `ads_read` + `business_management`.
  4. Start **Business Verification** for your company now: it gates every outside customer, for publishing too.
- **TikTok:**
  1. Register at business-api.tiktok.com with a **company-domain email** and a matching company website.
  2. Create an app with Ad Account Information + Campaign/Ad Group/Ad (read) + Reporting scopes.
  3. Wait 2–3 business days for approval, then create a sandbox ad account.
- **New env vars:**
  - `META_ADS_CONFIG_ID` (the Login for Business configuration ID)
  - `TIKTOK_BUSINESS_APP_ID`
  - `TIKTOK_BUSINESS_SECRET`
  - `GOOGLE_API_KEY` (PageSpeed/CrUX/YouTube)

---

## 5. Data model (Firestore, per workspace)

- `workspaces/{id}/brandKit/current`: logo URLs, colour roles, fonts, tagline, voice profile, style profile, version, source (manual/website).
- `workspaces/{id}/brandReferences/{refId}`: original + downscaled URLs, AI tags/caption, embedding, size.
- `workspaces/{id}/carousels/{id}`: brief, slide JSON, template, image URLs, rendered URLs, status.
- `workspaces/{id}/competitors/{id}`: handles/links; `.../snapshots/{date}` holds Instagram/YouTube metrics (YouTube kept ≤30 days); `.../briefs/{id}` holds AI briefs.
- `workspaces/{id}/swipeFile/{id}`: saved ads (image/link, notes, tags).
- `workspaces/{id}/siteAudits/{id}`: scores, vitals, findings, AI actions, timestamps (no raw HTML kept).
- `workspaces/{id}/adConnections/{provider}`: encrypted token, ad account IDs, currency, timezone, scopes; `.../adStats/{date}` holds the nightly normalised metrics.

All of these are server-side (Admin SDK) behind `withWorkspace` with role checks, and get explicit Firestore rules if the client ever reads them directly. Tokens use the existing AES-GCM token encryption.

---

## 6. Costs, limits and plans

- **Running costs at test scale are cents:**
  - carousel about $0.10–0.40 with GPT Image 2.5 Flare (2 images, medium–high quality), about $0.05–0.10 on the fast tier
  - competitor brief under $0.05
  - website audit about $0.01 (the Google APIs are free)
  - ads sync free
- **Proposed plan gating** (to confirm):
  - **Starter:** brand kit + 1 website audit/month.
  - **Nano:** + carousels (limited) + 3 competitors.
  - **Creator:** + 10 competitors, Meta/TikTok ads read-only.
  - **Agency:** unlimited per client workspace + exportable reports.
- **Limits enforced:** the existing monthly `checkLimit` counters, with new keys `carousels`, `siteAudits`, `competitors`.

## 7. Risks and compliance

- **Platform terms:**
  - no scraping of ad libraries or TikTok
  - competitor data only from official APIs or the user's own saved swipe file
  - YouTube stats follow the 30-day / no-blended-score rules
- **Approvals gate outside customers:**
  - Meta Business Verification and App Review
  - TikTok business developer approval
  - Google verification (for GA4/Search Console later)
  - Phases 1–3 don't depend on any of them.
- **POPIA:**
  - only business/aggregate data is stored
  - no harvesting of personal details from websites
  - users consent to reference images being processed by AI providers (paid API tiers don't train on them)
  - the privacy policy names AI sub-processors and cross-border processing
  - tokens are encrypted and deleted on disconnect
- **Deployment:** carousel rendering and website audits run Chrome, so they live in the API container (not Vercel), which matches the existing deployment plan.
- **AI image generation:**
  - Uses real models through OpenRouter and Higgsfield (section 1.5).
  - Higgsfield deletes outputs after 7 days, so results are always copied to our storage.
  - Paid API tiers don't train on customer images.
  - Users consent to reference images being processed by these providers.
  - The existing "generate image" in the AI writer returns stock placeholder photos and is replaced by the same adapter.
