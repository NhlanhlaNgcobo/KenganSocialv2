"""
AI background removal for the editor (no green screen needed).

Each frame goes through MODNet (portrait matting, Apache-2.0, ONNX build from Xenova/modnet) to get
a soft person matte. The person is composited onto a flat key colour and encoded as an ordinary
MP4; the editor then keys that colour out with its green screen key (chromakey + despill), so the
preview and the export reuse one tested keying path and no alpha-capable codec is needed.
"""
from __future__ import annotations

import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Callable, Optional

import cv2
import numpy as np

log = logging.getLogger("background_removal")

MODEL_PATH = Path(os.getenv("MODNET_MODEL_PATH", Path(__file__).parent / "models" / "modnet.onnx"))
MODEL_URL = "https://huggingface.co/Xenova/modnet/resolve/main/onnx/model.onnx"
# Pure green: far from skin, hair and most clothing, so the editor's key can stay tight.
KEY_BGR = (0, 255, 0)
KEY_HEX = "#00ff00"
# Matte resolution (shorter side). MODNet was trained around 512; 320 keeps CPU time reasonable
# (about 165 ms a frame on a 16-thread laptop CPU, against 260 ms at 384).
REF_SIZE = int(os.getenv("MODNET_REF_SIZE", "320"))
# Matte every Nth frame and reuse it in between: people move little in 1/30 s.
STRIDE = max(1, int(os.getenv("MODNET_STRIDE", "2")))
# Temporal smoothing of the matte: weight of the new frame (1 = none). Removes edge flicker.
SMOOTHING = 0.7
MAX_SECONDS = float(os.getenv("BG_REMOVE_MAX_SECONDS", "600"))

_session = None


def model_available() -> bool:
    return MODEL_PATH.is_file()


def _get_session():
    global _session
    if _session is None:
        import onnxruntime as ort

        if not model_available():
            raise RuntimeError(f"Background removal model missing at {MODEL_PATH}. Run scripts/download_models.py.")
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = max(1, (os.cpu_count() or 2) - 1)
        _session = ort.InferenceSession(str(MODEL_PATH), opts, providers=["CPUExecutionProvider"])
    return _session


def _matte_size(width: int, height: int) -> tuple[int, int]:
    scale = REF_SIZE / min(width, height)
    w = max(32, int(round(width * scale / 32)) * 32)
    h = max(32, int(round(height * scale / 32)) * 32)
    return w, h


def person_matte(frame_bgr: np.ndarray) -> np.ndarray:
    """Soft matte (float32, 0..1, frame size) of the people in a BGR frame."""
    height, width = frame_bgr.shape[:2]
    mw, mh = _matte_size(width, height)
    rgb = cv2.cvtColor(cv2.resize(frame_bgr, (mw, mh), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB)
    x = (rgb.astype(np.float32) / 255.0 - 0.5) / 0.5
    x = np.transpose(x, (2, 0, 1))[None]
    session = _get_session()
    matte = session.run(None, {session.get_inputs()[0].name: x})[0][0, 0]
    return cv2.resize(matte, (width, height), interpolation=cv2.INTER_LINEAR).clip(0, 1)


def _probe(path: str) -> tuple[int, int, float, float, bool]:
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise ValueError("Could not open the video.")
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frames = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
    cap.release()
    has_audio = False
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", path],
            capture_output=True, text=True, timeout=30,
        )
        has_audio = bool(out.stdout.strip())
    except (OSError, subprocess.TimeoutExpired):
        pass
    return width, height, fps, frames / fps if fps else 0.0, has_audio


def remove_background(input_path: str, output_path: str, report: Optional[Callable[[float], None]] = None) -> dict:
    """Writes `output_path` (MP4): the people from `input_path` on a flat KEY_HEX background."""
    width, height, fps, duration, has_audio = _probe(input_path)
    if not width or not height:
        raise ValueError("This file has no video picture.")
    if duration > MAX_SECONDS:
        raise ValueError(f"Background removal works on clips up to {int(MAX_SECONDS // 60)} minutes. Trim the clip first.")
    total = max(1, int(round(duration * fps)))
    ffmpeg = shutil.which("ffmpeg") or "ffmpeg"
    cmd = [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{width}x{height}", "-r", f"{fps:.6f}", "-i", "-",
    ]
    if has_audio:
        cmd += ["-i", input_path, "-map", "0:v", "-map", "1:a", "-c:a", "aac", "-b:a", "192k", "-shortest"]
    # yuv420p plays everywhere; the editor's key and despill tolerate the softer colour edges.
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", output_path]
    encoder = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    key = np.empty((height, width, 3), np.uint8)
    key[:] = KEY_BGR
    cap = cv2.VideoCapture(input_path)
    previous = None
    done = 0
    coverage = 0.0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if previous is None or done % STRIDE == 0:
                matte = person_matte(frame)
                if previous is not None:
                    matte = SMOOTHING * matte + (1 - SMOOTHING) * previous
                previous = matte
            coverage += float(previous.mean())
            out = cv2.blendLinear(frame, key, previous, 1 - previous)
            encoder.stdin.write(out.tobytes())
            done += 1
            if report and done % 10 == 0:
                report(min(0.99, done / total))
    except BrokenPipeError:
        pass
    finally:
        cap.release()
        if encoder.stdin:
            try:
                encoder.stdin.close()
            except BrokenPipeError:
                pass
        err = encoder.stderr.read().decode("utf-8", "replace") if encoder.stderr else ""
        encoder.wait()
    if encoder.returncode != 0 or done == 0:
        raise RuntimeError(f"Encoding failed: {err.strip()[-400:] or 'no frames decoded'}")
    share = coverage / done
    if share < 0.01:
        raise ValueError("No person was found in this clip. Background removal works on people (presenters, dancers, talking heads).")
    if report:
        report(1.0)
    return {"frames": done, "keyColor": KEY_HEX, "personShare": round(share, 3)}
