# KenganSocial video service (FastAPI: transcription, clip analysis, face framing, YouTube import)
FROM python:3.11-slim-bookworm

# FFmpeg for decoding/encoding; libglib for OpenCV (headless build, no GUI libraries needed).
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg libglib2.0-0 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Deno: yt-dlp needs a JavaScript runtime to solve YouTube's player challenges (YouTube import).
COPY --from=denoland/deno:bin-2.1.4 /deno /usr/local/bin/deno

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Includes models/face_detection_yunet_2023mar.onnx (face framing).
COPY . .

EXPOSE 8000

# PORT is honoured when a host sets it (default 8000, which docker-compose uses).
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
