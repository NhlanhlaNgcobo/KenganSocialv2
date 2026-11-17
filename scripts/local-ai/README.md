# Local open-source AI (testing only)

Runs KenganSocial's AI features on open models on this PC (RTX 3050 Laptop, 4 GB). Nothing here is
part of the production deploy: the code paths below switch on only through settings production
never has, and `server/.env` is not edited.

| Feature | Local model | Licence | Runs on |
|---|---|---|---|
| Text, plans, JSON (captions, hooks, carousels, image ads, AI edit…) | Qwen3-VL 4B Instruct via Ollama | Apache-2.0 (Ollama: MIT) | GPU, ~3.6 GB VRAM |
| Image understanding (style learning, Recreate, video analysis) | same model (`OLLAMA_VISION=on`) | Apache-2.0 | GPU |
| Voiceover (video ads) | Kokoro-82M int8 via kokoro-onnx | Apache-2.0 / MIT | CPU, ~3 s per line |
| Speech-to-text | faster-whisper (already in the app) | MIT | CPU |
| AI images | not local (needs ~8 GB VRAM): free Pollinations FLUX.2 klein | Apache-2.0 | hosted |
| AI music | not local (too big for 4 GB): free music library | — | — |

Optional: `GROQ_API_KEY` adds open-weights Whisper large-v3 turbo as a cloud speech-to-text provider.

## One-time setup (done on this PC on 2026-11-02)

1. Ollama: `winget install --id Ollama.Ollama -e` then
   `"%LOCALAPPDATA%\Programs\Ollama\ollama.exe" pull qwen3-vl:4b-instruct`
   Use the **-instruct** tag: the default `qwen3-vl:4b` is a thinking model that spends its output
   on reasoning and returns empty answers.
2. Kokoro, in a venv outside the repo (the repo is in OneDrive):
   ```
   py -3.13 -m venv %LOCALAPPDATA%\kengan-local-ai\.venv
   %LOCALAPPDATA%\kengan-local-ai\.venv\Scripts\python -m pip install kokoro-onnx soundfile
   ```
   Model files into `%LOCALAPPDATA%\kengan-local-ai\models` from
   https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0 :
   `kokoro-v1.0.int8.onnx` and `voices-v1.0.bin`.
3. ffmpeg on PATH (used to encode the voiceover as MP3).

## Run

```
bash scripts/local-ai/start-local-ai.sh     # Ollama + Kokoro + the API on :5000
cd client && npm run dev                    # the website on :5173
```

The API runs with `BACKGROUND_JOBS=off` because it shares the live Firebase project. Anything you
create while testing is saved to your real workspace, with files stored on this PC only: delete test
items when you're done.

## Settings (all optional, all unset in production)

| Setting | Effect |
|---|---|
| `AI_PROVIDER=ollama` | every text/JSON AI call goes to Ollama, no paid fallback |
| `OLLAMA_VISION=on` | images are sent to the model (needs a vision model) |
| `TTS_BASE_URL` | video-ad voiceover uses this local TTS server instead of ElevenLabs |
| `GROQ_API_KEY` | adds Groq Whisper as the last cloud speech-to-text option |

To stop: close the terminal running the script; quit Ollama from the system tray (or end
`ollama.exe`); the Kokoro server ends with its Python process.
