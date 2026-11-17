#!/usr/bin/env bash
# Starts the local open-source AI stack and the API configured to use it. TESTING ONLY:
# nothing here is used by the production deploy, and server/.env is not changed — every setting
# below applies to this one API process.
#
#   bash scripts/local-ai/start-local-ai.sh
#
# Then run the website as usual (cd client && npm run dev) and open http://localhost:5173.
# Setup steps (Ollama, model, Kokoro): scripts/local-ai/README.md
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OLLAMA="${LOCALAPPDATA}/Programs/Ollama/ollama.exe"
PYTHON="${LOCALAPPDATA}/kengan-local-ai/.venv/Scripts/python.exe"
MODEL="${OLLAMA_MODEL:-qwen3-vl:4b-instruct}"

up() { curl -s -o /dev/null --max-time 2 "$1"; }

if ! up http://127.0.0.1:11434/api/version; then
    echo "Starting Ollama…"
    "$OLLAMA" serve >/dev/null 2>&1 &
    for _ in $(seq 1 30); do up http://127.0.0.1:11434/api/version && break; sleep 1; done
fi
"$OLLAMA" list | grep -q "^${MODEL} " || { echo "Model ${MODEL} is missing: run  \"$OLLAMA\" pull ${MODEL}"; exit 1; }

if ! up http://127.0.0.1:8880/health; then
    echo "Starting the Kokoro voice server…"
    "$PYTHON" "$ROOT/scripts/local-ai/kokoro_server.py" >/dev/null 2>&1 &
    for _ in $(seq 1 30); do up http://127.0.0.1:8880/health && break; sleep 1; done
fi

echo "Ollama (${MODEL}) and Kokoro are up. Starting the API with local AI…"
cd "$ROOT/server"
# Text, planning and image understanding: the local vision model, no paid fallback.
# Voiceover: local Kokoro. Speech-to-text: the server's own faster-whisper (cloud transcription off).
# AI images and music stay on their free paths (Pollinations, the music library).
# BACKGROUND_JOBS=off: this API shares the live Firebase project, so it must not run the live
# schedulers. SERVER_URL: stored-file links point at this machine.
exec env \
    AI_PROVIDER=ollama \
    OLLAMA_BASE_URL=http://127.0.0.1:11434 \
    OLLAMA_MODEL="$MODEL" \
    OLLAMA_VISION=on \
    OLLAMA_NUM_CTX=8192 \
    OLLAMA_JSON_MAX_TOKENS=2500 \
    OLLAMA_MAX_TOKENS=900 \
    OLLAMA_TIMEOUT_MS=240000 \
    TTS_BASE_URL=http://127.0.0.1:8880 \
    LAUNCH_AI_FEATURES=voiceover,websiteAi,styleLearning,storyboardAi,thumbnailHeadlines,dmDrafts \
    BACKGROUND_JOBS=off \
    SERVER_URL=http://localhost:5000 \
    LOCAL_MEDIA_BASE_URL=http://localhost:5000 \
    npm run dev
