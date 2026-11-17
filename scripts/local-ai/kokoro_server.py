"""
Local voiceover for testing: Kokoro-82M (Apache-2.0) through kokoro-onnx, on this PC only.

Not used in production. The API uses it only when TTS_BASE_URL is set (see
server/src/services/video-ads/providers.js); production never sets it, so ElevenLabs stays.

  GET  /health
  GET  /v1/voices                      {"voices": [{"id", "name", "language", "gender"}]}
  POST /v1/audio/speech                {"input": "...", "voice": "af_heart", "speed": 1.0}
                                       -> audio/mpeg, header X-Audio-Duration (seconds)

Setup and start: scripts/local-ai/README.md. Listens on 127.0.0.1 only.
"""
import io
import json
import os
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import soundfile as sf
from kokoro_onnx import Kokoro

MODEL_DIR = os.environ.get("KOKORO_DIR") or os.path.join(os.environ.get("LOCALAPPDATA", "."), "kengan-local-ai", "models")
PORT = int(os.environ.get("KOKORO_PORT", "8880"))
MAX_CHARS = 2000

# Voice id prefix -> (language name, kokoro lang code). e.g. "af_heart" = American English, female.
LANGS = {
    "a": ("English (US)", "en-us"), "b": ("English (UK)", "en-gb"), "e": ("Spanish", "es"),
    "f": ("French", "fr-fr"), "h": ("Hindi", "hi"), "i": ("Italian", "it"),
    "j": ("Japanese", "ja"), "p": ("Portuguese (BR)", "pt-br"), "z": ("Mandarin", "cmn"),
}

kokoro = Kokoro(os.path.join(MODEL_DIR, "kokoro-v1.0.int8.onnx"), os.path.join(MODEL_DIR, "voices-v1.0.bin"))
VOICES = sorted(kokoro.get_voices())


def describe(voice_id):
    lang = LANGS.get(voice_id[:1], ("Other", "en-us"))
    gender = {"f": "female", "m": "male"}.get(voice_id[1:2], "")
    return {"id": voice_id, "name": voice_id.split("_", 1)[-1].replace("_", " ").title(), "language": lang[0], "gender": gender}


def to_mp3(samples, rate):
    wav = io.BytesIO()
    sf.write(wav, samples, rate, format="WAV")
    out = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "wav", "-i", "pipe:0", "-codec:a", "libmp3lame", "-q:a", "3", "-f", "mp3", "pipe:1"],
        input=wav.getvalue(), capture_output=True, check=True,
    )
    return out.stdout


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # requests carry ad scripts: don't print them
        pass

    def send(self, status, body, content_type="application/json", headers=None):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            return self.send(200, {"ok": True, "voices": len(VOICES)})
        if self.path == "/v1/voices":
            return self.send(200, {"voices": [describe(v) for v in VOICES]})
        self.send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/v1/audio/speech":
            return self.send(404, {"error": "not found"})
        try:
            length = min(int(self.headers.get("Content-Length") or 0), 64 * 1024)
            req = json.loads(self.rfile.read(length) or b"{}")
            text = str(req.get("input") or "").strip()[:MAX_CHARS]
            voice = str(req.get("voice") or "af_heart")
            speed = min(max(float(req.get("speed") or 1.0), 0.5), 2.0)
            if not text:
                return self.send(400, {"error": "input is empty"})
            if voice not in VOICES:
                return self.send(400, {"error": f"unknown voice {voice}"})
            samples, rate = kokoro.create(text, voice=voice, speed=speed, lang=LANGS.get(voice[:1], ("", "en-us"))[1])
            audio = to_mp3(samples, rate)
            self.send(200, audio, "audio/mpeg", {"X-Audio-Duration": f"{len(samples) / rate:.3f}"})
        except Exception as error:  # noqa: BLE001 - report, never crash the server
            self.send(500, {"error": type(error).__name__})


if __name__ == "__main__":
    print(f"Kokoro TTS on http://127.0.0.1:{PORT} ({len(VOICES)} voices, models in {MODEL_DIR})", flush=True)
    try:
        ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)
