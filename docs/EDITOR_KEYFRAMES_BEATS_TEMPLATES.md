# Editor: keyframes, beat sync, fill-in templates and exact preview

This covers the editor work after commit `c760188`: keyframe animation, beat detection and beat-synced editing, the Kengan template JSON format with its gallery, the exact preview, and the export-pipeline fixes found while proving preview/export parity. Each section ends with the check that verifies it.

## 1. Keyframes and easing

**Model.** Every timeline element may carry `keyframes: { x | y | scale | rotation | opacity: [{ t, v, ease }] }`.

- `t` is seconds from the element's start.
- `ease` shapes the segment from that keyframe to the next.
- A keyframed property replaces the static or camera value for that property.
- On text, scale and opacity keyframes multiply the style values.

**Easings.** There are 11: linear, hold, ease-in, ease-out, ease-in-out, expo-out ("Fast out"), expo-in-out ("Snap"), back-out ("Overshoot"), back-in ("Anticipate"), elastic-out and bounce-out. Each exists twice in `lib/keyframes.js`, written from the same formula: a JS function (preview) and an FFmpeg expression (export). The file is mirrored to `server/src/services/keyframes.js`.

**Editing.**

- The properties panel has a Keyframes section with:
  - a diamond to add or remove a keyframe at the playhead;
  - a value slider and a number field;
  - easing per segment;
  - previous/next keyframe navigation, "Key all" and "Clear".
- One-click presets:
  - In: Pop in, Slide up, Slide in left, Zoom reveal, Spin in, Drop bounce.
  - Out: Fade out, Zoom away, Slide out right.
  - Loop: Pulse, Wiggle, Slow push.
  - On the beat: Beat pulse, Beat shake, Beat flash.
- Diamonds on the timeline clip seek to their keyframe.
- Once a property is animated, changing it adds or updates a keyframe at the playhead.
- Trimming the head of a clip or splitting it keeps keyframes on the footage.

**Export.**

| Element | How keyframes render |
|---|---|
| Main track | Scale, position and rotation are per-frame FFmpeg expressions. Opacity is a per-frame lookup table (`sendcmd` + `lutrgb`) whose values come from the same `evaluateTrack` the preview uses. |
| Overlays | The same approach, on the overlay picture and its position. |
| Text | One ASS subtitle event per frame across the animated range, with the exact values. |

**Verified by:**

- `scripts/check-keyframes.mjs`: FFmpeg vs JS curves for all 11 easings, max difference about 1e-13.
- `scripts/check-editor-keyframes.mjs`: measured in exported pixels for position, opacity, overlay opacity, keyframes after a transition, scale keyframes, camera zoom-out, an overshooting ease and overlay scale. Positions are within 1 px, opacity within 6/255, sizes within 2 px and centring within 1 px.

## 2. Beat sync

**Detection** (`lib/beats.js`; pure functions, run in a Web Worker in the browser):

1. Band-wise log spectral flux: a 512-point FFT at 11 025 Hz in four bands, weighted equally so off-beat hi-hats can't outvote the kick and snare.
2. Tempo from the onset autocorrelation (60–180 BPM, weighted towards 120).
3. Beat tracking: each beat is expected one locally adapted period after the previous one, then pulled onto a strong onset within ±60 ms.
4. Tempo refined by a least-squares fit over the tracked beats.
5. Downbeats: the beat phase (of 4) with the strongest linear kick-band onsets.

Beat times are stored on the clip in **source seconds** (`MediaElement.beats`), so trimming, splitting and moving the music keeps the markers on the sound.

**In the editor** (select a music or video clip, then open the Beat sync section):

- **Detect beats** shows the BPM, the number of beats and how steady the pulse is. Beats appear as cyan ticks on the ruler, with taller ticks for downbeats.
- **Snap to beats**: dragging and trimming snap to beats and markers.
- **Add marker / Remove marker / Clear markers**: your own markers, shown as orange flags.
- **Cut the main track to the beat**:
  - "Montage" makes every clip last N beats: every beat, 2 beats, a bar (4) or 2 bars.
  - "Nearest beat" moves each cut to the nearest beat and keeps lengths close to what they were.
  - "Downbeats" restricts the grid to the first beat of each bar.
  - You can optionally put a flash, whip, zoom, crash, glitch or fade transition on every cut. Transitions are centred on the cut, so they hit the beat too.
  - The whole operation is one undo step.
- **Beat pulse / shake / flash** (Keyframes section) add keyframes on each beat under the clip.

**Verified by:**

- `scripts/check-beats.mjs`: synthetic tracks at 95, 128, 140 and 110 BPM (the last with ±15 ms human timing jitter). Every beat is within 12 ms (worst 6.7 ms), downbeats are 100% correct, silence gives no beats, and the mapping, cut planning and beat keyframes are unit-checked. The four real music files in testing gave the same tempo as the server's existing analysis.
- Browser test, in a real export:
  - a 120 BPM track is detected as 120 BPM, with 40 ticks and 10 downbeats;
  - "Cut to beat" with flashes puts both cuts on the beats (1.25 s and 2.25 s);
  - the flash peaks are within one frame of the beats;
  - the exported music's beats are within 6 ms of the source beats.

## 3. Fill-in templates (JSON)

**Format.** Schema `kengan.template/1`. `lib/template-schema.js` holds validation, params and timing; `lib/template-build.ts` builds timelines from templates and saves the current edit as one.

| Field | Meaning |
|---|---|
| `canvas` | `ratio` (9:16, 1:1, 16:9), `fps`, `background` |
| `timing` | `unit`: `seconds` or `beats` (with a reference `bpm`) |
| `slots[]` | Media placeholders in order: `id`, `label`, `accepts`, `length`, `speed`, `sourcePosition`, `fit`, `camera`, `transitionIn {type, duration}`, `effects[]`, `keyframes`, `color {look, intensity}` |
| `texts[]` | `content`, `start`, `length` (relative to `slot` when given), `style`, `motion` (caption motion, title motion, `fade` or `pop`), `keyframes` |
| `music` | `source` (`user` or `library`), `volume`, `originalVolume`, `startAt`, `beatSync` |
| `params[]` | User-editable values (`text`, `color`, `number`, `choice`) with `targets` such as `texts.<id>.content`, `texts.<id>.style.color`, `music.volume`, `pace` |

Rules:

- In beat timing, slot boundaries are placed **on the chosen song's detected beats**. The song starts on its first beat at or after `startAt`, so cuts stay on the music even when its tempo drifts.
- Keyframe times are seconds from the slot start. Scale keyframes are relative to the slot's fit scale, where 1 means the shot fills the canvas.
- Validation rejects anything it cannot repair and names the field. Examples: wrong schema, unknown ratio, transition, effect, look or motion, zero-length slots, duplicate ids, text anchored to a missing slot, and param targets that don't exist or don't fit the param type.
- Out-of-range numbers are clamped, and unknown fields are dropped.
- The known ids come from the export renderer, so a template that validates also renders.

**Gallery.** Templates → "Fill-in templates":

- Cards with a moving schematic preview of slot timing, transitions, camera moves, text and beat hits. The selected template's preview uses your media thumbnails.
- A slot list with a media picker per slot. It auto-fills from your media, and empty slots reuse other media, with a note.
- Text, colour and number fields for the params.
- A music picker; beat templates cut to that song.
- **Use template** applies everything as one undo step. Afterwards the timeline is fully editable.
- **Save edit as template** turns the current edit into a template:
  - main clips become slots;
  - timing is in beats when every cut sits on a beat of the music;
  - text becomes editable params.
- **Import JSON / Download JSON.** Saved templates live in this browser (`localStorage`); download them to keep or share a copy.

**Built-in templates** (`client/src/editor/templates/`, original designs):

| Template | Canvas | Timing | Slots | Highlights |
|---|---|---|---|---|
| Beat Montage 15 | 9:16 | 30 beats (15 s at 120 BPM) | 12 | Held opener with a punch-in, bursts of 2-beat cuts with flash, whip, zoom and glitch, crash-reveal hero with impact shake, spin-catch finale. Editable title, tagline, sign-off, accent colour, music volume. |
| Cinematic Slideshow 20 | 16:9 | 20 s | 6 | Slow push, pan, pull and tilt moves, teal & orange grade, long dissolves and luma bloom, fade from and to black, titled open and close. Works with photos. |
| Animated Promo 10 | 1:1 | 10 s | 5 | Hero pop-in (back-out scale + fade), crash and slide reveals, elastic tilt, offer with a pulse, CTA in your brand colour. |

**Verified by:**

- `scripts/check-templates.mjs`: valid, invalid and repaired inputs, params, timing in seconds and in drifting beats, and all built-in files.
- Browser test with real footage (podcast video, vertical video, landscape video, photos) and real music. See section 6 for results.

## 4. Exact preview

The **Exact preview** button (preview toolbar) renders 3 seconds around the playhead with the export engine and plays the result over the live preview.

- Internally it is an export with `range: { start, end }`.
- Main-track clips outside the window become black gaps.
- A clip that reaches into the window renders only from where it is needed, **keeping its time base**, so camera moves, keyframes and effects evaluate exactly as in the full export.
- Transitions away from the window are skipped.
- The output is cut to the window by frame number after every filter.

**Verified by:** `scripts/check-exact-preview.mjs`. Every frame of four range renders is compared with the same frame of the full export, using a moving test pattern so a one-frame slip shows. The four windows are:

- inside a zooming clip;
- across a clip-to-photo cut;
- across a fade transition;
- starting partway into a clip with keyframes, shake and overlay opacity.

## 5. Export pipeline fixes found by the parity checks

| Problem | Effect before | Fix |
|---|---|---|
| Transition join used container duration (includes AAC padding) | Every clip after a transition started 1 frame (33 ms) late against the timeline | xfade offsets use the video stream length; each run's audio is trimmed to its picture |
| Crop on 4:2:0 picture | Animated positions snapped to even pixels and truncated (up to 2 px lag) | Moving frames are processed in 4:4:4 with rounded positions |
| Animated zoom changed frame size mid-filter | Picture drifted off-centre during zooms (camera zoom moves, scale keyframes, overlay scale) | Constant-size pad (per-frame centring) before the crop |
| Per-pixel opacity expression (`geq`) | A 6 s clip with an opacity fade took 81 s to export | Per-frame lookup table: 8 s |
| Fill zoom scaled the whole letterboxed canvas | 16:9 footage on 9:16 was downscaled, then upscaled about 3×; slow and softer | Visible region cropped from the source, then scaled once; same geometry (correlation 0.994–1.000), as sharp or sharper |
| Camera shake used the source frame index | Differed from the preview for non-30 fps footage | Uses element time, as the preview does |
| Camera progress over the transition-extended length | Moves ran slightly slower than in the preview on clips with transitions | Progress uses the clip's own length |
| Segment length cut with `-t` to 3 decimals | Clips whose length isn't a whole number of frames could gain an extra frame, so later cuts drifted behind titles and music | Each segment renders an exact frame count, with rounding carried forward so every cut lands on its nearest frame |
| Plain cuts (no transition) joined by container length | AAC padding pushed each following clip up to 21 ms later than titles, overlays and music | The concat list gives each file its exact picture length |
| Concat moved the picture after the audio encoder delay | In exports without transitions, the whole picture ran 21 ms behind titles and music | The video stream is shifted back to start at 0 (stream copy) |
| Partial photo segments offset in seconds over a 1/30 s time base | Exact preview of a zooming photo ran a frame behind | The offset is given as an exact frame count in any time base |

`scripts/check-framing.mjs` compares the source framing with the old canvas zoom.

## 6. Checks

Run from the repository root:

```
node scripts/check-shared.mjs          # client/server shared modules identical
node scripts/check-keyframes.mjs       # easing curves: FFmpeg = JS
node scripts/check-editor-keyframes.mjs
node scripts/check-beats.mjs [music files…]
node scripts/check-templates.mjs
node scripts/check-exact-preview.mjs
node scripts/check-framing.mjs
node scripts/check-editor-motion.mjs   # existing: transitions, effects, caption/title motion
node scripts/check-editor-export.mjs   # existing: full export
node scripts/check-editor-browser.mjs  # existing: editor in a real browser
```

**Browser results with real footage.** At sample times, frames of the editor preview were compared with frames of the export.

| Template | Result |
|---|---|
| Beat Montage 15 | 12 shots, every cut within 10 ms of a music beat, export 15.03 s for a 15.00 s timeline. Preview vs export correlation: 0.966 (opener with scale keyframes and title), 0.992, 1.000. |

## 7. Known limitations

- **Export speed.** A 15 s, 12-shot 1080×1920 template exported in about 13 minutes on the test machine before the source-framing change, while other renders were running. It has not been re-timed alone since.
- **Pixel-level preview.** The editor preview is drawn by the browser (CSS and WebGL). It matches the export's timing and geometry, but text rendering and some effects differ at pixel level. Exact preview shows the real output.
- **Saved templates** are stored per browser. Server-side template storage per workspace is not built yet.
- **Library music.** Templates with `music.source: "library"` currently use music you choose from your media; automatic library song picking is only wired for the older auto-cut templates.
- **Beat detection** assumes a steady pulse. Free-time music reports a "loose" pulse, and you can place markers by hand.
