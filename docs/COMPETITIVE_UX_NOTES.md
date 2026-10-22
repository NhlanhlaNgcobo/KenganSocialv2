# Competitive UX notes: OpusClip

What we took from OpusClip (opus.pro) and how KenganSocial compares. Researched on 22 October 2026, from the public landing page and public reviews only. We did not sign in to OpusClip, inspect its app or code, or use REA on it (see `REA_REFERENCE_ANALYSIS.md`). Nothing below copies its code, text or images; these are general UX patterns, built our own way.

## Patterns adopted

| Pattern on opus.pro | What KenganSocial now does |
|---|---|
| Black and white interface; white pill buttons; colour only in content | Silver, white and black theme: silver-white accent on black (dark), black on white (light). Functional colours (success, warning, error) and colours chosen for user content stay as they are |
| One large "drop a video" input as the main hero action | Hero upload box: "Drop a long video here" (signed in: opens Clips with the file chosen; visitors: free sign-up) |
| The same input repeated as a bar that stays on screen while scrolling | A slim "Start free" bar appears once the hero has scrolled away and hides at the final call to action |
| Row of feature chips under the hero | Chips: AI clips, face-tracked reframe, animated captions, brand kit, scheduling, inbox and automations, Meta Ads |
| FAQ accordion | "Good to know": six questions, answered only with facts that are true of KenganSocial today |
| Brand templates (logo, colours, fonts) applied to clips | "Apply my brand" in the shorts settings (Clips and Repurpose): the brand kit's logo in the top corner (inside the platform safe zone), captions, hook card and progress bar in the brand colour. Text on a light brand colour turns black |

Not adopted: creator testimonials, follower counts and brand-logo walls. KenganSocial has no testers yet, so showing them would be invented.

## Feature comparison

| OpusClip | KenganSocial | Gap |
|---|---|---|
| ClipAnything (clips any genre) | Clips: transcript and signal analysis rank moments | Visual-only moments (no speech) |
| Virality score | Score out of 100 with hook / flow / value / trend bars | None |
| ReframeAnything (object tracking) | Auto / follow face / split speakers / full frame | Tracking non-face objects |
| Animated captions, brand vocabulary | 8 caption templates, word timing | Custom vocabulary |
| Brand templates | Brand kit + "Apply my brand" | Brand fonts on clips (fonts must be installed on the render server), intro/outro |
| Auto-post and scheduler | Calendar and scheduler for TikTok, Instagram, Facebook, YouTube | LinkedIn, X |
| AI editor with transcript editing | Timeline editor with keyframes, beats, templates, exact preview | Edit-by-transcript |
| Natural-language clip prompt | Prompt field on Clips (uses AI) | Needs an AI key |
| Link import (YouTube, Drive, Zoom…) | File upload; YouTube link import is off for policy reasons | Google Drive / Dropbox / direct-file links |
| Team workspace, API | Workspaces, members, client approvals | Public API |

## Next candidates

1. Edit-by-transcript in the editor: delete words to cut the video.
2. Import from Google Drive, Dropbox or a direct file link (no platform-policy issue, unlike YouTube).
3. Brand intro/outro cards on clips, and bundling the brand kit's Google Fonts for rendering.
4. LinkedIn and X publishing.
