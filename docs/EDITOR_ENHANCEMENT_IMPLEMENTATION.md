# KenganSocial editor implementation

## Delivered catalogue

| Collection | Added | Available total |
|---|---:|---:|
| Gym video recipes | 10 | 10 |
| Lifestyle video recipes | 10 | 10 |
| Vlog video recipes | 10 | 10 |
| Other Kengan video recipes | 10 | 10 |
| Video templates, including existing templates | 40 | 54 |
| Caption styles | 10 | 33 |
| Transitions | 10 | 45 |
| Effects | 10 | 21 |
| Title animations | 10 | 10 new motions plus existing fade/pop |
| Camera motions | 10 | 10 new motions plus existing zoom in/out |

## Editing workflow

1. Import videos or photos.
2. Open Templates and choose Gym, Lifestyle, Vlog, or All stories.
3. Choose a recipe. The imported footage pool is automatically assigned to its shot list.
4. Include/exclude sources, override individual slots, change pace and edit titles.
5. Apply. The main track, text and any reference overlays remain editable. One undo restores the preceding timeline and canvas ratio.

Assignment ranks filename keywords against shot labels, then available duration and orientation. It uses each source once before reuse, except deliberate opening-shot reprises. It is deterministic metadata matching, not visual scene recognition. Descriptive filenames such as `chalk-detail.mp4`, `squat-action.mp4`, or `sunset-wide.mp4` improve results. Insufficient footage is reused; short footage shortens the relevant shot. Timings are recipe-based, not audio beat detection.

Gym recipes include Last Rep, Progress Proof, Push Day Log, Pull Day Details, Leg Day Descent, PR Attempt, Form Check, Before the City Wakes, Superset Switch and A Week of Work. Lifestyle and vlog collections specify their own narrative sequences, shot lengths, chapter titles, overlays and selected transition accents; they are not a single timing preset with renamed labels.

## Preview and export

- Shared caption evaluation drives word highlights, reveal, underline, scale and position in preview and ASS subtitle export.
- Edited caption words have editable timestamps. When content no longer matches original transcription, timing falls back to evenly spaced words.
- Ten title motions are available in Text, with hover/focus previews and controls in Properties.
- Ten camera presets are available under the main clip's Transform → Animate control. Amount adjusts travel and zoom; FFmpeg uses the same start/end values.
- Effects support bypass, strength and ordering. The stack is limited to six effects.
- Transition and spatial-effect browser previews are approximations of FFmpeg rendering. Temporal effects are explicitly marked as export-preview-only.
- Animated text is limited to 30 seconds per element and exports require FFmpeg with libass. Speed blocks are stepped speeds, not optical-flow ramps.

## Colour workflow

Existing basic correction, RGB curves, three tonal wheels, eight HSL bands, creative looks, imported 3D LUTs and vignette remain in place.

Added:

- Luma waveform, RGB parade, vectorscope and RGB histogram.
- Sampled original/graded frame comparison and near-black/near-white channel readouts.
- Grade export as a 33³ `.cube` LUT.
- One-step application of a grade to all video/image clips, with undo.

Scopes sample the selected source at up to five frames per second. They include the colour grade and source-space vignette, but exclude framing, composited overlays and timeline effects. They are labelled accordingly. The pipeline is display-referred SDR sRGB; it is not a managed log/HDR workflow or final-output broadcast compliance monitor. Spatial vignette is not included in exported LUT files.

## Architecture

- `client/src/editor/lib/creator-templates.ts`: 30 category-specific recipe definitions.
- `client/src/editor/lib/trend-templates.ts`: 10 additional Kengan recipes.
- `client/src/editor/lib/arrange-clips.ts`: pure deterministic footage assignment.
- `client/src/editor/lib/recipe-plan.ts`: pure timeline plan construction.
- `client/src/editor/lib/templates.ts`: guarded asynchronous preparation and atomic application.
- `client/src/editor/lib/camera-motion.js`: camera endpoints shared by client preview and export serialization.
- `client/src/editor/lib/caption-motion.js`: caption/title frame evaluation; mirrored to the server.
- `client/src/editor/lib/trend-effects.js` and `trend-transitions.js`: catalogues and render expressions; mirrored to the server.
- `client/src/editor/lib/color-scopes.ts`: scope measurements.
- `client/src/editor/components/properties/ColorScopes.tsx`: source sampling, comparison and scope display.
- `server/src/services/timeline-render.service.js` and `timeline-text-ass.js`: validated FFmpeg/ASS export.

No new external services, secrets, database tables or dependencies were introduced for these additions. Local source sampling does not upload footage. Existing server ownership checks remain in the render path. Template preparation checks cancellation, project changes and removed sources before committing.

## Research basis

Reviewed 20 October 2026:

- [CapCut gym collection](https://www.capcut.com/explore/capcut-template-for-the-gym): workout, slow-motion and multi-clip fitness families informed the gym recipes.
- [CapCut vlog collection](https://www.capcut.com/explore/vlog-of-the-day-filter): day-in-the-life, mini-vlog, weekend and slice-of-life families informed the chapter and diary recipes.
- [CapCut Lifestyle template](https://www.capcut.com/templates/Lifestyle-7141916062433479942): short multi-clip lifestyle sequencing.
- [CapCut text animation guidance](https://www.capcut.com/resource/how-to-animate-text-and-captions): animated text and caption presentation.
- [Adobe keyframe guidance](https://helpx.adobe.com/premiere/desktop/add-video-effects/control-effects-and-transitions-using-keyframes/about-keyframes.html): time-based transform controls.
- [Adobe Lumetri scopes](https://helpx.adobe.com/premiere/desktop/correct-color/add-color-effects/available-lumetri-scopes.html): waveform, parade, histogram and vectorscope measurement categories.

These sources establish editing families and reference workflows. The Kengan implementations are original recipes; they are not verified replicas of specific TikTok posts, and collection listings do not establish a live TikTok trend ranking.

## Validation

Run from the repository root:

```text
node scripts/check-shared.mjs
node scripts/check-editor-motion.mjs
node scripts/check-editor-export.mjs
node scripts/check-editor-browser.mjs
```

Production build: `npm.cmd run build` in `client`.

- 41 real FFmpeg preset render checks: 10 transitions, 10 effects, one combined effect stack, 10 caption motions and 10 title animations.
- Full export integration: transitions, overlays, captions, audio, source ownership and output duration; separate integration renders all 10 camera motions.
- Headless browser integration: all 40 new recipes, short-source handling, contiguous edits, category counts, metadata matching, empty pools, undo/redo, project ratio restoration, save/reload, caption timestamps, asynchronous cancellation, concurrent-edit preservation, effect bypass and live scope sampling.
- Shared client/server files checked for exact equality.
- Existing production-build warnings: Firebase static/dynamic import overlap and a large application bundle.

Validation uses generated media and a test-only auth context; live transcription, paid music services and authenticated production deployment are not exercised.
