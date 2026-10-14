# KenganSocial Python Video Service

FastAPI microservice for the active KenganSocial editor pipeline.

## What it does
- Local-first transcription with `faster-whisper`
- Local-first auto-edit scoring with `PySceneDetect`, `ffmpeg`, and OpenCV
- Optional AssemblyAI transcription fallback
- Optional Google Cloud Video Intelligence fallback
- Render, clip extraction, and thumbnail generation
- Firestore job progress updates and Firebase Storage uploads

## Setup

```bash
cd python-service
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Windows activation:

```bash
venv\Scripts\activate
```

## Required runtime
- Python 3.11+
- FFmpeg on PATH
- Firebase service account JSON referenced by `FIREBASE_SERVICE_ACCOUNT_PATH`

## Provider defaults
- `TRANSCRIPTION_PROVIDER=local`
- `CLIP_ANALYSIS_PROVIDER=local`

The service works without paid AI keys when:
- FFmpeg is installed
- Python dependencies are installed
- Firebase credentials are valid

## Optional fallbacks
- `ASSEMBLYAI_API_KEY` for `TRANSCRIPTION_PROVIDER=assemblyai`
- `GOOGLE_APPLICATION_CREDENTIALS` for `CLIP_ANALYSIS_PROVIDER=gcv`

## Endpoints
- `POST /process/transcribe`
- `POST /process/analyze-viral`
- `POST /process/render`
- `POST /process/extract-clip`
- `POST /process/generate-thumbnail`
- `GET /health`
