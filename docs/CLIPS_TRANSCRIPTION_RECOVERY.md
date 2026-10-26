# Clips transcription recovery

## Scope

Complete the interrupted long-video transcription change and rerun the owner's 41-minute YouTube source (`tbtaNH6gPec`) using the original five-clip settings. No social publishing is part of the test.

## Implementation

- Long sources use the configured Whisper API, OpenRouter first. Audio is extracted into five-minute mono MP3 chunks, with at most three requests in flight.
- Completed chunks advance transcription progress from 5% to 29%. Word timestamps are validated, offset onto the full source timeline, and bounded to each chunk and source duration.
- Each provider gets one retry before the next configured provider is tried. The recorded provider reflects the providers that actually succeeded.
- A failed chunk stops new work. In-flight workers settle before their temporary directory is removed.
- Sources of at least ten minutes with at least 40 recognized words try transcript-based AI moment selection before a full-video visual scan. If AI selection is unavailable, visual analysis runs and supplies fallback suggestions without repeating the AI call. Short or silent sources retain visual analysis. Face-aware framing still runs on each selected short.
- Local transcription remains available as a fallback. Its UI stage reports elapsed time, and its API wait is bounded to ten minutes. This HTTP deadline does not cancel an already-running Python inference thread.
- Low-confidence local language detection does not automatically force English. An explicitly configured fallback or forced language is respected.
- The same Whisper adapter serves lyric transcription; regression coverage verifies its segment/word contract.

## Existing optional configuration

| Setting | Behavior |
| --- | --- |
| `CLIP_TRANSCRIBE` | `auto` (default), `cloud`, or `local` |
| `CLOUD_TRANSCRIBE_MIN_MINUTES` | Positive automatic-cloud threshold; defaults to 10 |
| `WHISPER_LANGUAGE` | Explicit language for local transcription |
| `WHISPER_FALLBACK_LANGUAGE` | Opt-in language when local detection confidence is low |
| `WHISPER_MIN_LANGUAGE_CONFIDENCE` | Local fallback confidence threshold; defaults to 0.6 |

Existing provider credentials are reused. No credentials are included in test reports.

## Reproducible verification

- `node --test server/tests/clips/transcription.test.js`
- In `server`: `npm run typecheck` and `npm run test:security`
- In `client`: `npm run typecheck` and `npm run lint`
- In `python-service`: `venv/Scripts/python.exe -m unittest discover -s tests -v`
- Live API test: `node scripts/check-clips-e2e.mjs <original-project-id> <token-file>`
- For an explicitly authorized local account test, the API harness accepts `--owner-session` in place of a token file. It obtains a transient owner session using configured local Firebase credentials.
- Browser playback verification: `node scripts/check-clips-browser.mjs` with the local frontend running on port 5173.

Live tests create a new project and consume provider usage. Reports, downloaded MP4s, and screenshots are written under ignored `output/clips-e2e/`. Shared lyric behavior is covered by the mocked-provider regression tests. An additional live lyric upload was not run because automatic approval review rejected sending the old local fixture to an external transcription provider without specific payload authorization.

## Live result (24 October 2026)

Project `0066cb9b`, the owner's 41:07 YouTube source (`tbtaNH6gPec`), five TikTok clips of 30–60 s, split-speaker framing, the original prompt:

| Stage | Time |
| --- | --- |
| YouTube download | 1 min 45 s |
| Transcription (OpenRouter Whisper, 9 five-minute pieces; progress 5% → 29%) | 2 min 14 s |
| Finding the best moments (transcript-based AI selection) | 15 s |
| Rendering five shorts | about 3 min |
| **Total** | **7 min 11 s** (the CPU medium model had run for over an hour at 5%) |

Five 1080×1920 shorts (32–48 s, scores 81–87) with English captions matching the speech, split-speaker framing and titles such as "Why He Started His Own Fragrance Brand". The project page shows all five with hooks, scores and post copy. `scripts/check-clips-browser.mjs` waits for `<video>` elements, but the page shows poster images until a clip is played, so that check times out without indicating a fault.

The interrupted original project (`6099d390`) and two test attempts are marked failed and can be deleted from the Clips page.

## Regression results

- 5 transcription/selection tests passed (real FFmpeg chunk extraction; mocked speech providers).
- 48 existing server security/behavior tests passed.
- 3 Python media/language tests passed.
- Server and client TypeScript checks passed; frontend lint passed, including the updated progress message.
- No translation or forced-English setting was applied; the owner requested preservation of the original languages.
