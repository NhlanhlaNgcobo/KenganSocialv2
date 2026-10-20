# KenganSocial editor enhancement — Phase 1

Date: 20 October 2026  
Status: Requirements and source audit complete; implementation pending phase confirmation.  
Scope: 10 additional caption templates, 10 additional transitions, 10 additional effects, 10 additional video templates, and supporting editing controls.

## SaaS purpose

- Turn uploaded footage into editable social videos inside KenganSocial.
- Give beginners guided templates, useful defaults, and understandable controls.
- Give experienced editors precise timing, animation, audio, and colour controls.
- Adapt short-form editing techniques into original KenganSocial presets.
- Preserve existing projects, media, exports, account boundaries, and subscription rules.

## Current code audit

Inspection covers source code, not a running editor session. Existing behaviour has not been runtime-tested in this phase.

| Area | Source | Finding |
| --- | --- | --- |
| Active editor | `client/src/pages/VideoEditorPage.jsx`, `client/src/editor/Editor.tsx` | Page mounts the modular React/TypeScript editor. Extend this implementation. |
| Application | `client/package.json`, `server/package.json` | React 19, Vite, Zustand; Express, Firebase, FFmpeg rendering, and existing AI services. |
| Captions | `client/src/editor/lib/caption-templates.ts` | 23 presets. Text animation supports none/fade/pop. Current emphasis changes a caption's colour rather than highlighting individual spoken words. |
| Transitions | `client/src/editor/lib/fx.ts`, `server/src/services/timeline-fx.js` | 35 transitions, including 15 custom Kengan expressions. Browser previews and FFmpeg implementations are separate. |
| Effects | Same FX modules | 11 effects. Pixelate and echo are marked export-only. Other browser previews are approximations. |
| Video templates | `client/src/editor/lib/templates.ts` | 14 templates. Recipes accept one source video, a cut strategy, framing, captions, music, and a shared transition/effect choice. |
| Beat editing | `lib/templates.ts`, `lib/audio-features.ts` | Beat montage uses fixed 1.2-second cuts. Audio analysis estimates BPM and loudness for lyrics; it does not provide a beat-position sequence to this template engine. |
| Precision tools | `stores/timeline-store.ts`, `hooks/use-editor-shortcuts.ts` | Existing split, trim, snapping, ripple deletion, undo/redo, and shortcuts. Preserve and extend. |
| Animation | `client/src/editor/types.ts` | Constant clip speed and simple zoom animation; no general speed curve or transform keyframe model in this domain type. |
| Colour | `lib/color-pipeline.js`, `components/properties/ColorPanel.tsx` | Existing colour controls and LUT pipeline provide the advanced grading foundation. |
| Persistence | `stores/project-store.ts`, `Editor.tsx` | IndexedDB project version 1, keyed by Firebase user UID; export payload version 2. These are separate version contracts. |
| Export | `lib/export.ts`, `server/src/services/timeline-render.service.js`, `timeline-text-ass.js` | Client serialisation, server validation, FFmpeg composition, and ASS text must all support each added feature. |
| Account access | `server/src/controllers/manual-edit.controller.js` | Upload ownership and timeline source ownership are checked against the authenticated UID. Shared-workspace access needs separate verification. |
| Working tree | `git status --short` | Many pre-existing modified and untracked files, including editor/rendering files. Preserve those changes. |

### Compatibility issues to address during implementation

- Template application changes aspect ratio before collecting track undo state. Make template application transactional across settings and tracks.
- Template generation performs asynchronous music work after timeline mutation. Cancellation/failure must not leave a partially applied recipe or absorb unrelated edits into undo.
- Effects/transitions currently target main-track media. Additional composition templates must explicitly support their overlay operations.
- Caption animations must survive server validation; unsupported names currently become `none`.
- Current transition duration validation clamps to 0.2–2 seconds. Faster cuts need coordinated client/server rules and short-clip handling.
- Template replacement currently removes caption/template text tracks. New recipes must preserve user edits through a recoverable transaction.

## Core user types

| User | Required experience |
| --- | --- |
| Beginner creator | Choose an outcome, add footage, preview, apply, adjust a few controls, export. |
| Experienced editor | Direct timeline access, frame-accurate timing, keyframes, easing, effect order, speed curves, reusable settings. |
| Brand marketer | Editable hooks, product details, calls to action, safe text placement, consistent colours. |
| Agency editor | Existing client/workspace context, access controls, and review workflows remain compatible. |

## Research basis

| Evidence | Product implication | Confidence boundary |
| --- | --- | --- |
| [CapCut's current TikTok template guidance](https://www.capcut.com/help/templates-for-tiktok) identifies slow motion, beat sync, velocity, reaction edits, and multi-clip lifestyle stories. | Prioritise timing and composition recipes across these families. | Supports format families; does not verify that each proposed preset is individually trending. |
| [TikTok creative guidance](https://ads.tiktok.com/business/en/guides/what-is-ad-creative-guide?redirected=1) describes native vertical storytelling, captions, testimonials, transformations, and tutorials. | Provide narrative-specific templates with editable opening, proof, and payoff slots. | Creative guidance, not a ranked transition list. |
| [CapCut camera-transition guidance](https://www.capcut.com/resource/ai-camera-transitions-whip-pan-match-cut) describes whip pans, match cuts, and foreground wipes. | Require matching direction, framing, and source selection where the technique depends on footage. | Technique reference; not proof of regional popularity. |
| [Adobe time-remapping documentation](https://helpx.adobe.com/premiere/desktop/edit-projects/change-clip-speed/change-clip-speed-and-duration-using-time-remapping.html) describes speed keyframes and easing handles. | Add editable speed curves with consistent source-to-timeline mapping. | Reference for control design, not a claim of Premiere feature parity. |

Research checked on 20 October 2026. The catalogue below is an original proposed implementation of these editing families. It does not copy creator footage, paid template files, sound recordings, or proprietary application assets. South Africa-specific trend rankings were not established.

## Core features and interaction model

| Area | Beginner controls | Advanced controls |
| --- | --- | --- |
| Discovery | Animated previews, search, use-case filters, source requirements | Filter by duration, composition, motion, and required capabilities |
| Applying presets | Preview on own footage; one apply action; clear undo | Apply to explicit selection, chosen cut, or chosen range; inspect generated tracks |
| Captions | Readable defaults; transcript editing; safe-area guides | Word timing, emphasis selection, line breaks, animation timing, position and typography |
| Motion | Strength and duration | Position/scale/rotation/opacity keyframes, easing and focal points |
| Rhythm | Select audio and suggested beat cuts | Beat markers, manual tempo and offset, subdivisions and editable cut positions |
| Speed | Slow–fast–slow preset | Speed curve, source-time map, audio policy, frame interpolation selection where supported |
| Timeline | Guided mode with progressive disclosure | Existing timeline tools plus markers, track locks, explicit selection scope |
| Reliability | Autosave state, clear errors, cancellable preparation | Atomic undo/redo including ratio/settings; recoverable edits and versioned persistence |

Both modes edit the same project model. Templates produce editable timeline elements. Advanced controls remain available after applying a template.

## Caption templates — exactly 10 additions

Prefix all IDs with `ks-caption-`. Values below are proposed defaults; position must adapt to aspect ratio and safe-area guides.

| ID suffix / name | Distinct behaviour | Default / controls |
| --- | --- | --- |
| pulse-word — Pulse Word | Stable three-word line; only the spoken word lifts and changes colour. | 120 ms lift; active colour, lift, word timing |
| marker-sweep — Marker Sweep | A marker block travels behind each spoken word without shifting the line. | Four-word groups; block padding, colour, corner radius |
| kinetic-stack — Kinetic Stack | A phrase builds across three staggered lines; its final keyword settles larger. | Up to six words; stagger, keyword, alignment |
| quiet-reveal — Quiet Reveal | Words reveal in place with a subtle opacity rise; punctuation remains readable. | Six-word groups; 100 ms reveal, line width |
| receipt-proof — Receipt Proof | Number or price appears in a separate proof chip while the sentence continues. | Manual emphasis selection; chip style, currency, placement |
| dialogue-cards — Dialogue Cards | Alternating speaker-labelled cards with consistent timing and position. | Manual speaker assignment; labels, colours, side |
| type-on-note — Type-on Note | Actual progressive character reveal inside a compact editorial note. | Timing fitted to speech; cursor toggle, reveal rate |
| bounce-pair — Bounce Pair | Two-word phrases enter with a restrained spring; the second word arrives on its timestamp. | Overshoot 8%; damping, accent word, scale |
| focus-keyword — Focus Keyword | Context stays smaller while a user-selected keyword briefly expands in a separate line. | Emphasis duration 240 ms; keyword, hierarchy, spacing |
| underline-flow — Underline Flow | An underline follows spoken words while all text remains fixed. | Five-word groups; line thickness, offset, accent |

Dependencies: persistent word timestamps, reusable text layout, word/character animation evaluation, matching export rendering. Provide manual timing when transcription is unavailable.

## Transitions — exactly 10 additions

Prefix IDs with `ks-transition-`. Frame counts describe a 30 fps reference and must convert to seconds for other project frame rates.

| ID suffix / name | Actual transition behaviour | Defaults / required input |
| --- | --- | --- |
| whip-carry — Whip Carry | Outgoing acceleration and incoming deceleration share direction, with directional motion blur. | 10 frames; direction, travel, blur |
| crash-reveal — Crash Reveal | Rapid focal-point zoom into the cut, followed by a short incoming settle. | 12 frames; focal point, overshoot |
| spin-catch — Spin Catch | Matched rotation crosses the cut and eases into an upright incoming frame. | 14 frames; direction, angle, blur |
| lens-cover — Lens Cover | Feathered near-camera occlusion closes and clears across the cut. | 14 frames; mask direction, softness; synthetic mask disclosed |
| match-lock — Match Lock | User aligns corresponding subject points in two clips; brief scale/position correction hides the cut. | Two manual anchors; scale limit and alignment guides |
| focus-snap — Focus Snap | Defocus peaks at the cut; incoming detail snaps into focus with a slight pull-back. | 12 frames; blur radius, settle amount |
| tear-through — Tear Through | Irregular paper edge reveals the incoming clip with edge shading and texture. | 16 frames; tear direction, seed, edge width |
| shutter-roll — Shutter Roll | Moving exposure band and slight frame displacement simulate a shutter passing over the cut. | 10 frames; band width, exposure, displacement |
| elastic-pull — Elastic Pull | Directional picture stretch reaches maximum at the cut and springs back. | 12 frames; axis, stretch, damping |
| prism-pass — Prism Pass | A moving refractive strip displaces RGB channels and reveals the next image. | 14 frames; direction, refraction, strip width |

These require genuinely distinct motion/compositing implementations. Reusing a generic slide, flash, or wipe under a new label does not satisfy this catalogue. Match Lock is a footage-assisted workflow, not automatic semantic matching.

## Effects — exactly 10 additions

Prefix IDs with `ks-effect-`. Each effect has a visible time range, strength, reset, and bypass.

| ID suffix / name | Actual effect behaviour | Default / controls |
| --- | --- | --- |
| beat-punch — Beat Punch | Brief zoom envelopes trigger on selected music markers. | 6% zoom, 160 ms decay; beat selection and focal point |
| impact-shake — Impact Shake | A single damped directional jolt follows an impact marker. | 220 ms; amplitude, direction, damping, deterministic seed |
| halation — Highlight Halation | Warm bloom is restricted to bright edges rather than washing out the whole frame. | Threshold, radius, red bias, mix |
| chromatic-echo — Chromatic Echo | Offset time samples create coloured motion ghosts. | Two echoes; delay, direction, opacity |
| freeze-annotation — Freeze Annotation | Hold an explicitly chosen frame while a label and pointer enter. | 350 ms hold; frame, duration, label, pointer anchor |
| frame-cadence — Frame Cadence | Frame sampling creates intentional stop-motion rhythm while audio retains timing. | 12 visual samples/sec; cadence and blend |
| digicam-stamp — Digicam Stamp | Sensor-style noise, mild highlight clipping, and an editable timestamp overlay. | Stamp text, noise, bloom, timestamp visibility |
| spotlight-track — Spotlight Track | A feathered spotlight follows a manually keyframed focal point. | Radius, feather, background dim, path |
| split-diopter — Split Diopter | A configurable focus band keeps one region crisp while another softens. | Band width, angle, blur, feather |
| motion-smear — Motion Smear | Temporal/directional blur peaks around motion accents and clears afterward. | 180 ms envelope; sample count, direction, strength |

Temporal effects require frame-aware previews or cached render previews. Freeze Annotation changes timing and must remap subsequent captions, clips, and audio according to an explicit insert/replace policy.

## Video templates — exactly 10 additions

Prefix IDs with `ks-video-`. All default to 9:16 and generate editable tracks. Music comes from user media or the existing licensed library. Beat locations can be corrected manually.

| ID suffix / name | Source slots | Edit recipe |
| --- | --- | --- |
| drop-switch — Drop Switch | Before, reveal, detail; music | 12 seconds: 2-second setup, Lens Cover into reveal on chosen beat, three detail accents, 2-second payoff. |
| velocity-run — Velocity Run | Four action shots; music | 15 seconds: four slow–fast–slow arcs, Whip Carry at motion peaks, restrained Beat Punch on selected downbeats. |
| camera-roll — Camera Roll Diary | Eight photos/videos | 18 seconds: date opening, asymmetric two-panel memories, Tear Through chapter change, final full-frame hold. |
| proof-first — Proof First | Result, process, testimonial | 20 seconds: lead with result, Receipt Proof evidence, process inserts, spoken proof and editable CTA. |
| reaction-receipt — Reaction + Receipt | Presenter and evidence clip | 15 seconds: picture-in-picture reaction, evidence enlarges at the punchline, Freeze Annotation on the key frame. |
| fit-check — Fit Check Switch | Four outfit shots | 12 seconds: guided subject alignment, Match Lock cuts, two-beat detail hold, optional clothing labels. |
| desk-to-done — Desk to Done | Before, three steps, after | 20 seconds: before hook, three labelled process sections, Focus Snap to after, short comparison hold. |
| city-postcard — City Postcard | Six location/detail shots | 18 seconds: location note, paired wide/detail sequences, Prism Pass once at the midpoint, Halation on highlights, ambient ending. |
| mic-drop — Mic Drop Insight | Interview excerpt and optional B-roll | 25 seconds: user-selected opening claim, Pulse Word captions, two focal punches, one evidence insert, clean closing thought. |
| seamless-return — Seamless Return | Three to five shots with matching start/end action | 10 seconds: rhythmic sequence, end-frame alignment guide, matched final-to-first motion and adjustable audio loop seam. |

Fallback: if required media, timing, or matching action is absent, explain the missing slot and allow replacement. Never silently call evenly spaced cuts “beat synced” or an unmatched ending “seamless”.

## Monetization and integrations

- Preserve current internal tiers: `starter`, `nano`, `creator`, `agency`; display labels remain Free, Creator Starter, Creator Pro, Agency.
- Preserve existing export, AI, transcription, storage, and render limits. No new pricing or entitlement rules are proposed.
- Reuse Firebase authentication, current storage/upload services, Express rendering endpoints, FFmpeg/ASS, transcription/AI analysis, and existing music-library APIs.
- TikTok and CapCut are research references; this scope does not require a new account connection or trend-scraping integration.
- Keep transcript/media processing within existing access boundaries. Verify retention, deletion, and service disclosures for POPIA where personal information is processed.

## High-level data model

| Entity | Key data / relationships |
| --- | --- |
| Preset definition | Stable namespaced ID, category, schema version, display metadata, parameter schema, required capabilities |
| Preset instance | Preset ID/version, clip or cut target, parameter values, active time range, deterministic seed |
| Caption segment | Original text, word timestamps, manual edits, speaker labels, emphasis ranges, styling reference |
| Motion curve | Element ID, property, timeline-time keyframes, interpolation/easing |
| Speed map | Source-time/timeline-time mapping; used by preview, export, trimming, captions, and duration calculations |
| Beat map | Audio media ID, source offset, detected/manual beat timestamps, optional tempo/confidence |
| Template recipe | Media slots, ordered segments, text slots, layers, transitions, effects, soundtrack policy |
| Edit transaction | Before/after tracks and affected project settings; one undo/redo operation |
| Project | Existing project identity and media relationships; versioned optional additions and legacy defaults |

No database migration is justified yet. Built-in catalogue definitions can remain static code; editable project additions belong in the existing persistence model. Any later shared preset or cloud-project storage must enforce workspace membership and media ownership server-side.

## Acceptance criteria

1. Exactly 10 new entries in each requested category; all existing IDs and presets continue to load.
2. Each new entry has a distinct visual/timing behaviour, meaningful defaults, editable parameters, and preview.
3. Preview, seeking, scrubbing, export, autosave/reload, undo, and redo preserve new parameter values.
4. Old projects load without destructive migration; untouched projects retain baseline rendering behaviour.
5. Template preparation is cancellable before commit; application and rollback include project settings.
6. Beat edits use actual selected markers. Word animations use word timing. Speed changes remap media and captions consistently.
7. Check short clips, missing audio, mixed frame rates, portrait/landscape/square canvases, and cut boundaries.
8. Compare preview/export frames at beginning, midpoint, and end for each new animation; expose approximate previews honestly.
9. Verify project ownership, media access, export limits, and AI entitlements remain enforced.
10. Run the client build, targeted model/render tests, representative FFmpeg exports, and interactive editor checks during implementation. Record pre-existing failures separately.

## Assumptions

- “10 each” means 10 additional entries per category, not replacement of existing presets.
- The current React/Vite/Firebase architecture remains the implementation base.
- Beginner and advanced experiences share the same underlying timeline.
- Built-in creative presets use existing access rules; paid AI operations retain existing gates.
- General editing techniques are recreated with KenganSocial design and original code.
- Existing in-progress changes must be preserved.

## Missing information and phase boundary

| Item | Current disposition |
| --- | --- |
| Exact reference videos | None supplied. Research supports format families; exact clip-for-clip reproduction cannot be specified. |
| Regional trend selection | South Africa is a sensible research target from workspace context, but no region-specific ranking has been verified. |
| Runtime/render baseline | Pending implementation-stage checks, including FFmpeg capabilities and browser performance. |
| Phase progression | Repository instructions require confirmation after each phase. |

Required next decision: confirm Phase 1 to proceed to Phase 2 architecture.

Instruction source: [AGENTS.md](../AGENTS.md), “After each phase, you stop and wait for confirmation before proceeding.” Also: “Stop after Phase 1.”
