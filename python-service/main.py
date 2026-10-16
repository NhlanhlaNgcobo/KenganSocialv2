"""
KenganSocial Python FastAPI Video Processing Service
Canonical local-first video analysis pipeline for transcription and auto-editing.
"""

import asyncio
import json
import logging
import math
import os
import tempfile
import re
import shutil
import subprocess
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import aiofiles
import aiohttp
import cv2
import firebase_admin
import numpy as np
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from firebase_admin import credentials, firestore, storage
from pydantic import BaseModel

from autoframe import parse_ratio, plan_crop_path
from stabilizer import StabilizeOptions, stabilize_video

try:
    from faster_whisper import WhisperModel
except Exception:  # pragma: no cover - optional dependency
    WhisperModel = None

try:
    from google.cloud import videointelligence_v1 as vi
except Exception:  # pragma: no cover - optional dependency
    vi = None

try:
    from scenedetect import ContentDetector, SceneManager, open_video
except Exception:  # pragma: no cover - optional dependency
    ContentDetector = None
    SceneManager = None
    open_video = None


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("kengansocial.video")

# Working folder for downloads/renders: the OS temp dir (C:\Users\...\Temp on Windows, /tmp on Linux),
# overridable with VIDEO_TMP_DIR. A hard-coded "/tmp" breaks on Windows (it means C:\tmp).
TMP = Path(os.getenv("VIDEO_TMP_DIR") or tempfile.gettempdir())
TMP.mkdir(parents=True, exist_ok=True)
MAX_CONCURRENT_JOBS = 3
TRANSCRIBE_TIMEOUT_SEC = 600
ANALYZE_TIMEOUT_SEC = 900
ASSEMBLYAI_POLL_INTERVAL = 15
DEFAULT_TRANSCRIPTION_PROVIDER = os.getenv("TRANSCRIPTION_PROVIDER", "local").lower()
DEFAULT_CLIP_ANALYSIS_PROVIDER = os.getenv("CLIP_ANALYSIS_PROVIDER", "local").lower()

COLOUR_LUTS: Dict[str, List[float]] = {
    "warm": [1.1, 0.95, 0.85],
    "cool": [0.85, 0.95, 1.15],
    "cinematic": [1.05, 0.90, 0.85],
    "viral": [1.15, 1.05, 0.90],
    "original": [1.0, 1.0, 1.0],
    "none": [1.0, 1.0, 1.0],
    "matte": [0.95, 0.95, 0.92],
}

PLAN_TIERS = ["starter", "nano", "creator", "agency"]
WHISPER_MODEL_BY_PLAN = {
    "starter": None,
    "nano": os.getenv("WHISPER_MODEL_NANO", "base"),
    "creator": os.getenv("WHISPER_MODEL_CREATOR", "small"),
    "agency": os.getenv("WHISPER_MODEL_AGENCY", "medium"),
}
WHISPER_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
SCENE_THRESHOLD = float(os.getenv("SCENEDETECT_THRESHOLD", "27"))
MIN_KEEP_SEGMENT_SEC = float(os.getenv("MIN_KEEP_SEGMENT_SEC", "2.5"))
BLACK_FRAME_MIN_DURATION = float(os.getenv("BLACK_FRAME_MIN_DURATION", "0.35"))
SILENCE_MIN_DURATION = float(os.getenv("SILENCE_MIN_DURATION", "0.75"))
HOOK_BURST_WINDOW_SEC = 5.0

job_semaphore: asyncio.Semaphore = None  # type: ignore
WHISPER_MODELS: Dict[str, Any] = {}

load_dotenv()
load_dotenv(Path(__file__).resolve().parents[1] / "server" / ".env", override=False)


def init_firebase():
    if firebase_admin._apps:
        return
    cred_path = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH", "serviceAccount.json")
    # The path usually comes from server/.env, so a relative path is relative to server/.
    server_relative = Path(__file__).resolve().parents[1] / "server" / cred_path
    if not Path(cred_path).exists() and server_relative.exists():
        cred_path = str(server_relative)
    if Path(cred_path).exists():
        cred = credentials.Certificate(cred_path)
    else:
        cred = credentials.Certificate(
            {
                "type": "service_account",
                "project_id": os.getenv("FIREBASE_PROJECT_ID"),
                "private_key_id": os.getenv("FIREBASE_PRIVATE_KEY_ID", ""),
                "client_email": os.getenv("FIREBASE_CLIENT_EMAIL"),
                "private_key": (os.getenv("FIREBASE_PRIVATE_KEY") or "").replace("\\n", "\n"),
                "client_id": os.getenv("FIREBASE_CLIENT_ID", ""),
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
                "client_x509_cert_url": os.getenv("FIREBASE_CLIENT_X509_CERT_URL", ""),
            }
        )
    firebase_admin.initialize_app(
        cred,
        {
            "storageBucket": os.getenv("FIREBASE_STORAGE_BUCKET", ""),
        },
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    global job_semaphore
    job_semaphore = asyncio.Semaphore(MAX_CONCURRENT_JOBS)
    init_firebase()
    log.info("Video service started (local-first pipeline, max %d jobs)", MAX_CONCURRENT_JOBS)
    yield
    for file_path in TMP.glob("kengan-*"):
        try:
            file_path.unlink()
        except Exception:
            pass
    log.info("Video service shutdown complete")


app = FastAPI(
    title="KenganSocial Video Processing Service",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class TranscribeRequest(BaseModel):
    videoUrl: str
    jobId: str
    workspaceId: str
    plan: str = "creator"


class AnalyzeViralRequest(BaseModel):
    videoUrl: str
    jobId: str
    workspaceId: str
    plan: str = "creator"
    analysisPreferences: Optional[Dict[str, Any]] = None
    stylePreset: Optional[Dict[str, Any]] = None


class Cut(BaseModel):
    start: float
    end: float


class RenderRequest(BaseModel):
    videoUrl: str
    cuts: List[Cut]
    subtitles: Optional[List[Dict[str, Any]]] = None
    cropRatio: Optional[str] = "16:9"
    colorGrade: Optional[str] = "none"
    jobId: str
    workspaceId: str


class ExtractClipRequest(BaseModel):
    videoUrl: str
    start: float
    end: float
    jobId: str
    workspaceId: str
    cropRatio: Optional[str] = "16:9"


class ThumbnailRequest(BaseModel):
    videoUrl: str
    timestamp: float = 0.0
    jobId: str
    workspaceId: str


def update_job(job_id: str, data: Dict[str, Any]):
    try:
        firestore.client().collection("render_jobs").document(job_id).set(data, merge=True)
    except Exception as exc:
        log.warning("Firestore update failed for %s: %s", job_id, exc)


async def download_file(url: str, dest: Path) -> Path:
    if url.startswith("file://"):
        shutil.copy2(Path(url.replace("file://", "")), dest)
        return dest

    local_path = Path(url)
    if local_path.exists():
        shutil.copy2(local_path, dest)
        return dest

    async with aiohttp.ClientSession() as session:
        async with session.get(url) as resp:
            resp.raise_for_status()
            async with aiofiles.open(dest, "wb") as file_handle:
                async for chunk in resp.content.iter_chunked(1 << 20):
                    await file_handle.write(chunk)
    return dest


def cleanup(*paths: Path):
    for path in paths:
        try:
            path.unlink(missing_ok=True)
        except Exception:
            pass


def upload_to_storage(local_path: Path, storage_path: str) -> str:
    bucket = storage.bucket()
    blob = bucket.blob(storage_path)
    blob.upload_from_filename(str(local_path))
    blob.make_public()
    return blob.public_url


def run_command(*cmd: str, timeout: Optional[int] = None) -> subprocess.CompletedProcess:
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        stderr = result.stderr[-3000:] if result.stderr else ""
        raise RuntimeError(f"Command failed: {' '.join(cmd)}\n{stderr}")
    return result


def run_ffmpeg(*args: str) -> subprocess.CompletedProcess:
    cmd = ("ffmpeg", "-y", *args)
    log.info("ffmpeg: %s", " ".join(cmd))
    return run_command(*cmd)


def run_ffmpeg_inspect(*args: str) -> subprocess.CompletedProcess:
    cmd = ("ffmpeg", "-hide_banner", "-nostats", *args)
    log.info("ffmpeg inspect: %s", " ".join(cmd))
    return run_command(*cmd)


def get_video_duration(video_path: Path) -> float:
    result = run_command(
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(video_path),
    )
    try:
        return float(result.stdout.strip())
    except ValueError:
        return 0.0


def load_job_transcription(job_id: str) -> Dict[str, Any]:
    try:
        payload = firestore.client().collection("render_jobs").document(job_id).get()
        if payload.exists:
            return payload.to_dict().get("transcription", {}) or {}
    except Exception as exc:
        log.warning("Failed to read transcription for %s: %s", job_id, exc)
    return {}


def interval_overlap(start_a: float, end_a: float, start_b: float, end_b: float) -> float:
    return max(0.0, min(end_a, end_b) - max(start_a, start_b))


def segment_overlap_ratio(start: float, end: float, segments: Iterable[Dict[str, float]]) -> float:
    total = max(end - start, 0.001)
    overlap = 0.0
    for segment in segments:
        seg_start = float(segment.get("startSec", 0.0))
        seg_end = float(segment.get("endSec", 0.0))
        overlap += interval_overlap(start, end, seg_start, seg_end)
    return min(overlap / total, 1.0)


def detect_black_segments(
    video_path: Path,
    sample_every_n_frames: int = 12,
    darkness_threshold: float = 12.0,
) -> List[Dict[str, float]]:
    cap = cv2.VideoCapture(str(video_path))
    fps = max(cap.get(cv2.CAP_PROP_FPS), 1)
    black_ranges: List[Dict[str, float]] = []
    current_range: Optional[List[float]] = None
    frame_index = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_index % sample_every_n_frames == 0:
            mean_brightness = float(frame.mean())
            timestamp = frame_index / fps
            if mean_brightness <= darkness_threshold:
                if current_range is None:
                    current_range = [timestamp, timestamp]
                else:
                    current_range[1] = timestamp
            elif current_range is not None:
                if current_range[1] - current_range[0] >= BLACK_FRAME_MIN_DURATION:
                    black_ranges.append(
                        {
                            "startSec": round(current_range[0], 2),
                            "endSec": round(current_range[1], 2),
                        }
                    )
                current_range = None
        frame_index += 1

    if current_range is not None and current_range[1] - current_range[0] >= BLACK_FRAME_MIN_DURATION:
        black_ranges.append(
            {
                "startSec": round(current_range[0], 2),
                "endSec": round(current_range[1], 2),
            }
        )

    cap.release()
    return black_ranges


def detect_black_segments_ffmpeg(video_path: Path) -> List[Dict[str, float]]:
    try:
        result = run_ffmpeg_inspect(
            "-i",
            str(video_path),
            "-vf",
            f"blackdetect=d=0.3:pix_th=0.10",
            "-an",
            "-f",
            "null",
            "-",
        )
        output = f"{result.stdout}\n{result.stderr}"
        matches = re.findall(r"black_start:(?P<start>[\d\.]+)\s+black_end:(?P<end>[\d\.]+)", output)
        segments = []
        for start, end in matches:
            if float(end) - float(start) >= BLACK_FRAME_MIN_DURATION:
                segments.append({"startSec": round(float(start), 2), "endSec": round(float(end), 2)})
        return segments
    except Exception as exc:
        log.info("ffmpeg blackdetect unavailable, falling back to OpenCV: %s", exc)
        return []


def merge_time_ranges(segments: List[Dict[str, Any]], gap_tolerance: float = 0.25) -> List[Dict[str, Any]]:
    if not segments:
        return []
    ordered = sorted(segments, key=lambda seg: seg["startSec"])
    merged = [ordered[0].copy()]
    for segment in ordered[1:]:
        last = merged[-1]
        if segment["startSec"] <= last["endSec"] + gap_tolerance:
            last["endSec"] = max(last["endSec"], segment["endSec"])
            last["score"] = max(float(last.get("score", 0)), float(segment.get("score", 0)))
            if segment.get("reason") and segment["reason"] not in last.get("reason", ""):
                last["reason"] = f"{last.get('reason', 'Strong segment')}; {segment['reason']}"
        else:
            merged.append(segment.copy())
    return merged


def merge_keep_segments(segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    filtered = [segment for segment in segments if segment["endSec"] - segment["startSec"] >= MIN_KEEP_SEGMENT_SEC]
    return merge_time_ranges(filtered, gap_tolerance=0.5)


def detect_scene_boundaries(video_path: Path, duration: float) -> List[float]:
    boundaries = {0.0, round(duration, 2)}
    if open_video and SceneManager and ContentDetector:
        try:
            video = open_video(str(video_path))
            scene_manager = SceneManager()
            scene_manager.add_detector(ContentDetector(threshold=SCENE_THRESHOLD))
            scene_manager.detect_scenes(video)
            for _, end_time in scene_manager.get_scene_list():
                boundaries.add(round(end_time.get_seconds(), 2))
        except Exception as exc:
            log.warning("PySceneDetect failed, falling back to heuristic windows: %s", exc)

    ordered = sorted(boundary for boundary in boundaries if 0 <= boundary <= duration)
    if len(ordered) <= 2:
        cursor = 0.0
        while cursor < duration:
            cursor = min(duration, cursor + 4.0)
            boundaries.add(round(cursor, 2))
        ordered = sorted(boundaries)
    return ordered


def parse_silence_segments(video_path: Path) -> List[Dict[str, float]]:
    try:
        result = run_ffmpeg_inspect(
            "-i",
            str(video_path),
            "-af",
            "silencedetect=noise=-35dB:d=0.6",
            "-f",
            "null",
            "-",
        )
        output = f"{result.stdout}\n{result.stderr}"
        starts = [float(value) for value in re.findall(r"silence_start:\s*([\d\.]+)", output)]
        ends = [float(value) for value in re.findall(r"silence_end:\s*([\d\.]+)", output)]
        segments: List[Dict[str, float]] = []
        for idx, end in enumerate(ends):
            start = starts[idx] if idx < len(starts) else max(0.0, end - SILENCE_MIN_DURATION)
            if end - start >= SILENCE_MIN_DURATION:
                segments.append({"startSec": round(start, 2), "endSec": round(end, 2)})
        return segments
    except Exception as exc:
        log.warning("silencedetect failed: %s", exc)
        return []


def build_ass_subtitle(subtitles: List[Dict[str, Any]], out_path: Path):
    header = (
        "[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n"
        "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, Bold, Italic, Alignment, MarginV, Outline, Shadow\n"
        "Style: Default,Arial,72,&H00FFFFFF,&H00000000,-1,0,2,80,3,1\n\n"
        "[Events]\nFormat: Layer, Start, End, Style, Text\n"
    )

    def ms_to_ass(ms: float) -> str:
        total_seconds = int(ms) // 1000
        centiseconds = (int(ms) % 1000) // 10
        hours, remainder = divmod(total_seconds, 3600)
        minutes, seconds = divmod(remainder, 60)
        return f"{hours}:{minutes:02}:{seconds:02}.{centiseconds:02}"

    lines = [header]
    for subtitle in subtitles:
        start = ms_to_ass(subtitle.get("start_ms", 0))
        end = ms_to_ass(subtitle.get("end_ms", 0))
        text = subtitle.get("text", "").replace("\n", "\\N")
        lines.append(f"Dialogue: 0,{start},{end},Default,,{text}")
    out_path.write_text("\n".join(lines), encoding="utf-8")


def detect_face_center(video_path: Path, target_ratio: str = "9:16") -> Optional[str]:
    ratio_w, ratio_h = (int(value) for value in target_ratio.split(":"))
    cap = cv2.VideoCapture(str(video_path))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, total // 4))
    ret, frame = cap.read()
    cap.release()

    if not ret or frame is None:
        return None

    video_height, video_width = frame.shape[:2]
    target_width = int(video_height * ratio_w / ratio_h)
    if target_width > video_width:
        target_width = video_width

    cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    cascade = cv2.CascadeClassifier(cascade_path)
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4)

    if len(faces) > 0:
        face_x, _, face_w, _ = max(faces, key=lambda face: face[2] * face[3])
        center_x = face_x + face_w // 2
        crop_x = max(0, min(center_x - target_width // 2, video_width - target_width))
    else:
        crop_x = (video_width - target_width) // 2

    return f"crop={target_width}:{video_height}:{crop_x}:0"


def get_whisper_model(plan: str):
    model_name = WHISPER_MODEL_BY_PLAN.get(plan) or WHISPER_MODEL_BY_PLAN["creator"]
    if not model_name or WhisperModel is None:
        return None
    if model_name not in WHISPER_MODELS:
        log.info("Loading faster-whisper model: %s", model_name)
        WHISPER_MODELS[model_name] = WhisperModel(model_name, device="cpu", compute_type=WHISPER_COMPUTE_TYPE)
    return WHISPER_MODELS[model_name]


def local_transcribe(audio_path: Path, plan: str) -> Dict[str, Any]:
    model = get_whisper_model(plan)
    if model is None:
        return {"words": [], "highlights": [], "speakers": [], "duration_seconds": 0.0}

    segments, info = model.transcribe(
        str(audio_path),
        word_timestamps=True,
        vad_filter=True,
        beam_size=1,
        condition_on_previous_text=False,
    )

    words: List[Dict[str, Any]] = []
    segment_summaries: List[Dict[str, Any]] = []
    for segment in segments:
        segment_words = getattr(segment, "words", None) or []
        if segment_words:
            for word in segment_words:
                token = (word.word or "").strip()
                if not token:
                    continue
                start_ms = int(round(float(word.start) * 1000))
                end_ms = int(round(float(word.end) * 1000))
                words.append(
                    {
                        "text": token,
                        "start": start_ms,
                        "end": max(end_ms, start_ms + 80),
                        "confidence": round(float(getattr(word, "probability", 0.0) or 0.0), 4),
                    }
                )
        else:
            text_tokens = [piece for piece in (segment.text or "").strip().split() if piece]
            seg_start = float(segment.start)
            seg_end = float(segment.end)
            if text_tokens:
                word_span = max((seg_end - seg_start) / len(text_tokens), 0.08)
                for idx, token in enumerate(text_tokens):
                    start_ms = int(round((seg_start + idx * word_span) * 1000))
                    end_ms = int(round((seg_start + (idx + 1) * word_span) * 1000))
                    words.append({"text": token, "start": start_ms, "end": end_ms, "confidence": 0.0})

        cleaned_text = (segment.text or "").strip()
        if cleaned_text:
            density = len(cleaned_text.split()) / max(float(segment.end) - float(segment.start), 0.5)
            excitement = 0.2 if "?" in cleaned_text or "!" in cleaned_text else 0.0
            early_bonus = 0.15 if float(segment.start) <= HOOK_BURST_WINDOW_SEC else 0.0
            segment_summaries.append(
                {
                    "text": cleaned_text,
                    "start": float(segment.start),
                    "end": float(segment.end),
                    "score": round(min(density / 3.5, 1.0) + excitement + early_bonus, 4),
                }
            )

    highlights = []
    for summary in sorted(segment_summaries, key=lambda item: item["score"], reverse=True)[:5]:
        highlights.append(
            {
                "text": summary["text"],
                "rank": summary["score"],
                "timestamps": [
                    {
                        "start": int(round(summary["start"] * 1000)),
                        "end": int(round(summary["end"] * 1000)),
                    }
                ],
            }
        )

    duration_seconds = float(getattr(info, "duration", 0.0) or 0.0)
    return {
        "words": words,
        "highlights": highlights,
        "speakers": [],
        "duration_seconds": round(duration_seconds, 2),
    }


async def assemblyai_transcribe(audio_path: Path, job_id: str) -> Dict[str, Any]:
    assemblyai_key = os.getenv("ASSEMBLYAI_API_KEY", "")
    if not assemblyai_key:
        raise RuntimeError("ASSEMBLYAI_API_KEY is required when TRANSCRIPTION_PROVIDER=assemblyai")

    headers = {"authorization": assemblyai_key, "content-type": "application/json"}
    async with aiohttp.ClientSession() as session:
        async with aiofiles.open(audio_path, "rb") as audio_handle:
            audio_data = await audio_handle.read()

        async with session.post(
            "https://api.assemblyai.com/v2/upload",
            headers={"authorization": assemblyai_key},
            data=audio_data,
        ) as upload_response:
            upload_response.raise_for_status()
            upload_json = await upload_response.json()
            upload_url = upload_json["upload_url"]

        async with session.post(
            "https://api.assemblyai.com/v2/transcript",
            headers=headers,
            json={
                "audio_url": upload_url,
                "auto_highlights": True,
                "speaker_labels": True,
                "punctuate": True,
                "format_text": True,
            },
        ) as transcript_response:
            transcript_response.raise_for_status()
            transcript_json = await transcript_response.json()
            transcript_id = transcript_json["id"]

        deadline = time.time() + TRANSCRIBE_TIMEOUT_SEC
        progress = 40
        while True:
            if time.time() > deadline:
                raise HTTPException(504, "Transcription timed out after 10 minutes")

            await asyncio.sleep(ASSEMBLYAI_POLL_INTERVAL)
            async with session.get(
                f"https://api.assemblyai.com/v2/transcript/{transcript_id}",
                headers=headers,
            ) as status_response:
                status_response.raise_for_status()
                payload = await status_response.json()

            if payload["status"] == "completed":
                words = [
                    {
                        "text": word.get("text", ""),
                        "start": int(word.get("start", 0)),
                        "end": int(word.get("end", 0)),
                        "confidence": round(float(word.get("confidence", 0.0) or 0.0), 4),
                    }
                    for word in payload.get("words", [])
                    if word.get("text")
                ]
                return {
                    "words": words,
                    "highlights": payload.get("auto_highlights_result", {}).get("results", []),
                    "speakers": payload.get("utterances", []),
                    "duration_seconds": round(float(payload.get("audio_duration", 0.0) or 0.0), 2),
                }

            if payload["status"] == "error":
                raise RuntimeError(payload.get("error", "AssemblyAI transcription failed"))

            progress = min(progress + 5, 90)
            update_job(job_id, {"progress": progress})


def normalize_auto_edit_preferences(
    analysis_preferences: Optional[Dict[str, Any]],
    style_preset: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    style_auto = ((style_preset or {}).get("settings") or {}).get("autoEdit") or {}
    merged = {
        "goal": style_auto.get("goal", "high-retention"),
        "aggressiveness": style_auto.get("aggressiveness", "balanced"),
        "removeBlackFrames": style_auto.get("removeBlackFrames", True),
        "removeSilence": style_auto.get("removeSilence", False),
        "preserveHookSeconds": float(style_auto.get("preserveHookSeconds", 3) or 0),
        "minClipLength": float(style_auto.get("minClipLength", 6) or 6),
        "maxClipLength": float(style_auto.get("maxClipLength", 18) or 18),
        "hookBoost": float(style_auto.get("hookBoost", 0.25) or 0.25),
        "speechDensityWeight": float(style_auto.get("speechDensityWeight", 0.35) or 0.35),
        "sceneChangeWeight": float(style_auto.get("sceneChangeWeight", 0.30) or 0.30),
        "faceWeight": float(style_auto.get("faceWeight", 0.15) or 0.15),
        "silencePenalty": float(style_auto.get("silencePenalty", 0.20) or 0.20),
        "blackFrameTolerance": float(style_auto.get("blackFrameTolerance", 0.05) or 0.05),
    }
    merged.update(analysis_preferences or {})

    aggressiveness = merged.get("aggressiveness", "balanced")
    defaults_by_mode = {
        "light": {"minClipLength": 8.0, "maxClipLength": 22.0, "keepCount": 3},
        "balanced": {"minClipLength": 6.0, "maxClipLength": 18.0, "keepCount": 5},
        "aggressive": {"minClipLength": 4.0, "maxClipLength": 12.0, "keepCount": 7},
    }
    defaults = defaults_by_mode.get(aggressiveness, defaults_by_mode["balanced"])
    merged["minClipLength"] = float(merged.get("minClipLength", defaults["minClipLength"]) or defaults["minClipLength"])
    merged["maxClipLength"] = max(
        merged["minClipLength"],
        float(merged.get("maxClipLength", defaults["maxClipLength"]) or defaults["maxClipLength"]),
    )
    merged["keepCount"] = int(merged.get("keepCount", defaults["keepCount"]) or defaults["keepCount"])

    goal = merged.get("goal", "high-retention")
    if goal == "story-first":
        merged["sceneChangeWeight"] = float(merged.get("sceneChangeWeight", 0.22))
        merged["speechDensityWeight"] = max(float(merged.get("speechDensityWeight", 0.35)), 0.42)
    elif goal == "sales-focused":
        merged["speechDensityWeight"] = max(float(merged.get("speechDensityWeight", 0.35)), 0.48)
        merged["hookBoost"] = max(float(merged.get("hookBoost", 0.25)), 0.35)
    return merged


def build_candidate_windows(duration: float, scene_boundaries: List[float], options: Dict[str, Any]) -> List[Dict[str, float]]:
    min_len = float(options["minClipLength"])
    max_len = float(options["maxClipLength"])
    preferred = min(max((min_len + max_len) / 2, min_len), max_len)
    boundaries = sorted({round(boundary, 2) for boundary in scene_boundaries if 0 <= boundary <= duration})
    windows: List[Dict[str, float]] = []
    anchor = 0.0
    while anchor < duration - 0.5:
        candidate_ends = [boundary for boundary in boundaries if anchor + min_len <= boundary <= anchor + max_len]
        if candidate_ends:
            target = anchor + preferred
            end = min(candidate_ends, key=lambda boundary: abs(boundary - target))
        else:
            end = min(duration, anchor + preferred)
        if end - anchor >= min_len * 0.8:
            windows.append({"start": round(anchor, 2), "end": round(end, 2)})
        anchor = max(anchor + max(min_len / 2, preferred * 0.65), end - min_len * 0.35)
    return windows or [{"start": 0.0, "end": round(min(duration, max_len), 2)}]


def build_word_index(words: List[Dict[str, Any]]) -> List[Dict[str, float]]:
    indexed = []
    for word in words:
        start_ms = float(word.get("start", 0) or 0)
        end_ms = float(word.get("end", start_ms) or start_ms)
        indexed.append(
            {
                "startSec": start_ms / 1000.0,
                "endSec": max(end_ms / 1000.0, start_ms / 1000.0 + 0.05),
            }
        )
    return indexed


def measure_speech_density(start: float, end: float, indexed_words: List[Dict[str, float]]) -> Tuple[float, int]:
    word_count = 0
    punctuation_burst = 0
    for word in indexed_words:
        if interval_overlap(start, end, word["startSec"], word["endSec"]) > 0:
            word_count += 1
            if word["startSec"] <= HOOK_BURST_WINDOW_SEC:
                punctuation_burst += 1
    duration = max(end - start, 0.5)
    words_per_second = word_count / duration
    return min(words_per_second / 3.0, 1.0), punctuation_burst


def estimate_face_presence(video_path: Path, start: float, end: float) -> float:
    cap = cv2.VideoCapture(str(video_path))
    fps = max(cap.get(cv2.CAP_PROP_FPS), 1.0)
    cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    cascade = cv2.CascadeClassifier(cascade_path)
    sample_points = np.linspace(start, end, num=3)
    hits = 0
    attempts = 0

    for point in sample_points:
        attempts += 1
        cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, int(point * fps)))
        ok, frame = cap.read()
        if not ok or frame is None:
            continue
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4)
        if len(faces) > 0:
            hits += 1

    cap.release()
    return hits / max(attempts, 1)


def describe_window_reason(start: float, end: float, score_parts: Dict[str, float], words_count: int) -> str:
    reasons = []
    if score_parts["scene"] >= 0.45:
        reasons.append("fast scene changes")
    if score_parts["speech"] >= 0.45:
        reasons.append(f"strong speech density ({words_count} words)")
    if score_parts["face"] >= 0.5:
        reasons.append("clear subject presence")
    if score_parts["hook"] > 0:
        reasons.append("opening hook protected")
    if not reasons:
        reasons.append("balanced pacing and clarity")
    return "; ".join(reasons)


def choose_keep_segments(
    windows: List[Dict[str, float]],
    options: Dict[str, Any],
    indexed_words: List[Dict[str, float]],
    scene_boundaries: List[float],
    silence_segments: List[Dict[str, float]],
    black_segments: List[Dict[str, float]],
    video_path: Path,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    keep_candidates: List[Dict[str, Any]] = []
    clip_candidates: List[Dict[str, Any]] = []
    keep_count = int(options["keepCount"])
    scene_weight = float(options["sceneChangeWeight"])
    speech_weight = float(options["speechDensityWeight"])
    face_weight = float(options["faceWeight"])
    silence_penalty = float(options["silencePenalty"])
    black_tolerance = float(options["blackFrameTolerance"])
    hook_boost = float(options["hookBoost"])
    preserve_hook = float(options.get("preserveHookSeconds", 0) or 0)

    for window in windows:
        start = float(window["start"])
        end = float(window["end"])
        duration = max(end - start, 0.5)
        cuts = sum(1 for boundary in scene_boundaries if start < boundary < end)
        scene_density = min((cuts / duration) * 1.7, 1.0)
        speech_density, words_count = measure_speech_density(start, end, indexed_words)
        face_presence = estimate_face_presence(video_path, start, end)
        silence_ratio = segment_overlap_ratio(start, end, silence_segments)
        black_ratio = segment_overlap_ratio(start, end, black_segments)
        hook_score = 0.0
        if preserve_hook and start <= preserve_hook:
            hook_score = hook_boost
        elif start <= HOOK_BURST_WINDOW_SEC and words_count >= 8:
            hook_score = hook_boost * 0.6

        total_score = (
            scene_density * scene_weight
            + speech_density * speech_weight
            + face_presence * face_weight
            + hook_score
            - silence_ratio * silence_penalty
            - max(0.0, black_ratio - black_tolerance) * 0.4
        )
        total_score = round(max(total_score, 0.0), 4)
        score_parts = {
            "scene": round(scene_density, 4),
            "speech": round(speech_density, 4),
            "face": round(face_presence, 4),
            "silence": round(silence_ratio, 4),
            "black": round(black_ratio, 4),
            "hook": round(hook_score, 4),
        }
        reason = describe_window_reason(start, end, score_parts, words_count)
        candidate = {
            "startSec": round(start, 2),
            "endSec": round(end, 2),
            "score": total_score,
            "reason": reason,
            "thumbnailUrl": None,
        }
        clip_candidates.append(candidate)
        if total_score > 0:
            keep_candidates.append(candidate)

    keep_segments = merge_keep_segments(sorted(keep_candidates, key=lambda item: item["score"], reverse=True)[: keep_count * 2])
    keep_segments = sorted(keep_segments, key=lambda item: item["score"], reverse=True)[:keep_count]
    keep_segments = sorted(keep_segments, key=lambda item: item["startSec"])

    if preserve_hook:
        keep_segments.insert(
            0,
            {
                "startSec": 0.0,
                "endSec": round(min(preserve_hook, keep_segments[0]["startSec"] if keep_segments else preserve_hook), 2),
                "score": 1.0,
                "reason": "Protected opening hook",
                "thumbnailUrl": None,
            },
        )
        keep_segments = merge_keep_segments(keep_segments)

    top_clips = sorted(clip_candidates, key=lambda item: item["score"], reverse=True)[: max(5, keep_count)]
    return keep_segments, top_clips


def build_edit_decisions(
    keep_segments: List[Dict[str, Any]],
    black_segments: List[Dict[str, float]],
    silence_segments: List[Dict[str, float]],
    options: Dict[str, Any],
) -> List[Dict[str, Any]]:
    decisions: List[Dict[str, Any]] = []
    for segment in keep_segments:
        decisions.append(
            {
                "type": "keep",
                "startSec": segment["startSec"],
                "endSec": segment["endSec"],
                "reason": segment.get("reason", "High-value moment"),
            }
        )

    protected = [{"startSec": seg["startSec"], "endSec": seg["endSec"]} for seg in keep_segments]
    if options.get("removeBlackFrames", True):
        for segment in black_segments:
            decisions.append(
                {
                    "type": "cut",
                    "startSec": segment["startSec"],
                    "endSec": segment["endSec"],
                    "reason": "Black frames / dead space detected",
                }
            )

    if options.get("removeSilence", False):
        for segment in silence_segments:
            overlap = segment_overlap_ratio(segment["startSec"], segment["endSec"], protected)
            if overlap >= 0.4:
                continue
            decisions.append(
                {
                    "type": "cut",
                    "startSec": segment["startSec"],
                    "endSec": segment["endSec"],
                    "reason": "Silence / low-energy section detected",
                }
            )

    unique: List[Dict[str, Any]] = []
    seen = set()
    for decision in sorted(decisions, key=lambda item: (item["startSec"], item["type"] != "keep")):
        key = (decision["type"], round(decision["startSec"], 2), round(decision["endSec"], 2), decision["reason"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(decision)
    return unique


def analyze_with_gcv(
    video_path: Path,
    req: AnalyzeViralRequest,
    options: Dict[str, Any],
) -> Dict[str, Any]:
    if vi is None:
        raise RuntimeError("google-cloud-videointelligence is not installed")

    client = vi.VideoIntelligenceServiceClient()
    with open(video_path, "rb") as file_handle:
        input_content = file_handle.read()

    operation = client.annotate_video(
        request={
            "features": [
                vi.Feature.SHOT_CHANGE_DETECTION,
                vi.Feature.LABEL_DETECTION,
                vi.Feature.SPEECH_TRANSCRIPTION,
                vi.Feature.PERSON_DETECTION,
            ],
            "input_content": input_content,
        }
    )
    result = operation.result(timeout=ANALYZE_TIMEOUT_SEC)
    annotation = result.annotation_results[0]

    shots = [
        (
            shot.start_time_offset.total_seconds(),
            shot.end_time_offset.total_seconds(),
        )
        for shot in annotation.shot_annotations
    ]
    duration = max((shot[1] for shot in shots), default=get_video_duration(video_path))
    scene_boundaries = detect_scene_boundaries(video_path, duration)
    black_segments = merge_time_ranges(detect_black_segments(video_path) + detect_black_segments_ffmpeg(video_path))
    silence_segments = parse_silence_segments(video_path) if options.get("removeSilence") else []
    transcription = load_job_transcription(req.jobId)
    indexed_words = build_word_index(transcription.get("words", []))
    windows = build_candidate_windows(duration, scene_boundaries, options)
    keep_segments, top_clips = choose_keep_segments(
        windows,
        options,
        indexed_words,
        scene_boundaries,
        silence_segments,
        black_segments,
        video_path,
    )
    edit_decisions = build_edit_decisions(keep_segments, black_segments, silence_segments, options)
    return {
        "clips": top_clips,
        "keepSegments": keep_segments,
        "blackFrameSegments": black_segments,
        "silenceSegments": silence_segments,
        "editDecisions": edit_decisions,
        "analysisProvider": "gcv",
    }


def analyze_locally(video_path: Path, req: AnalyzeViralRequest, options: Dict[str, Any]) -> Dict[str, Any]:
    duration = get_video_duration(video_path)
    scene_boundaries = detect_scene_boundaries(video_path, duration)
    black_segments = merge_time_ranges(detect_black_segments(video_path) + detect_black_segments_ffmpeg(video_path))
    silence_segments = parse_silence_segments(video_path) if options.get("removeSilence") else []
    transcription = load_job_transcription(req.jobId)
    indexed_words = build_word_index(transcription.get("words", []))
    windows = build_candidate_windows(duration, scene_boundaries, options)
    keep_segments, top_clips = choose_keep_segments(
        windows,
        options,
        indexed_words,
        scene_boundaries,
        silence_segments,
        black_segments,
        video_path,
    )
    edit_decisions = build_edit_decisions(keep_segments, black_segments, silence_segments, options)
    return {
        "clips": top_clips,
        "keepSegments": keep_segments,
        "blackFrameSegments": black_segments,
        "silenceSegments": silence_segments,
        "editDecisions": edit_decisions,
        "analysisProvider": "local",
    }


@app.post("/process/transcribe")
async def transcribe(req: TranscribeRequest, background_tasks: BackgroundTasks):
    del background_tasks
    if req.plan == "starter":
        raise HTTPException(
            402,
            detail={
                "error": "PLAN_LIMIT",
                "message": "Transcription is not available on the Starter plan.",
                "upgradeUrl": "/settings/billing",
            },
        )

    async with job_semaphore:
        video_path = TMP / f"kengan-trans-{req.jobId}.mp4"
        audio_path = TMP / f"kengan-trans-{req.jobId}.wav"
        update_job(req.jobId, {"status": "processing", "progress": 5})

        try:
            await download_file(req.videoUrl, video_path)
            update_job(req.jobId, {"progress": 15})

            run_ffmpeg(
                "-i",
                str(video_path),
                "-vn",
                "-acodec",
                "pcm_s16le",
                "-ar",
                "16000",
                "-ac",
                "1",
                str(audio_path),
            )
            update_job(req.jobId, {"progress": 30})

            provider = DEFAULT_TRANSCRIPTION_PROVIDER
            if provider == "assemblyai":
                transcription = await assemblyai_transcribe(audio_path, req.jobId)
            else:
                transcription = await asyncio.to_thread(local_transcribe, audio_path, req.plan)
            transcription["transcriptionProvider"] = provider

            update_job(req.jobId, {"status": "completed", "progress": 100})
            return transcription
        finally:
            cleanup(video_path, audio_path)


@app.post("/process/analyze-viral")
async def analyze_viral(req: AnalyzeViralRequest):
    async with job_semaphore:
        video_path = TMP / f"kengan-analyze-{req.jobId}.mp4"
        update_job(req.jobId, {"status": "processing", "progress": 55})

        try:
            await download_file(req.videoUrl, video_path)
            update_job(req.jobId, {"progress": 65})
            options = normalize_auto_edit_preferences(req.analysisPreferences, req.stylePreset)

            provider = DEFAULT_CLIP_ANALYSIS_PROVIDER
            if provider == "gcv":
                payload = await asyncio.to_thread(analyze_with_gcv, video_path, req, options)
            else:
                payload = await asyncio.to_thread(analyze_locally, video_path, req, options)

            update_job(req.jobId, {"status": "completed", "progress": 100})
            return payload
        finally:
            cleanup(video_path)


@app.post("/process/render")
async def render(req: RenderRequest):
    async with job_semaphore:
        video_path = TMP / f"kengan-render-in-{req.jobId}.mp4"
        output_path = TMP / f"kengan-render-out-{req.jobId}.mp4"
        ass_path = TMP / f"kengan-render-{req.jobId}.ass"
        segment_paths: List[Path] = []

        update_job(req.jobId, {"status": "processing", "progress": 5})

        try:
            await download_file(req.videoUrl, video_path)
            update_job(req.jobId, {"progress": 15})

            if req.cuts:
                for index, cut in enumerate(req.cuts):
                    segment = TMP / f"{req.jobId}_seg{index}.mp4"
                    segment_paths.append(segment)
                    run_ffmpeg(
                        "-ss",
                        str(cut.start),
                        "-to",
                        str(cut.end),
                        "-i",
                        str(video_path),
                        "-c",
                        "copy",
                        str(segment),
                    )

                if len(segment_paths) > 1:
                    concat_list = TMP / f"kengan-render-concat-{req.jobId}.txt"
                    concat_list.write_text("\n".join(f"file '{path}'" for path in segment_paths), encoding="utf-8")
                    trimmed = TMP / f"kengan-render-trim-{req.jobId}.mp4"
                    run_ffmpeg("-f", "concat", "-safe", "0", "-i", str(concat_list), "-c", "copy", str(trimmed))
                    cleanup(concat_list)
                else:
                    trimmed = segment_paths[0]
            else:
                trimmed = video_path

            update_job(req.jobId, {"progress": 35})

            crop_filter = detect_face_center(trimmed, req.cropRatio or "16:9") or ""
            update_job(req.jobId, {"progress": 45})

            subtitle_filter = ""
            if req.subtitles:
                build_ass_subtitle(req.subtitles, ass_path)
                escaped = str(ass_path).replace("\\", "/").replace(":", "\\:")
                subtitle_filter = f",subtitles='{escaped}'"

            lut = COLOUR_LUTS.get(req.colorGrade or "none", COLOUR_LUTS["none"])
            color_filter = f"colorbalance=rs={lut[0] - 1:.2f}:gs={lut[1] - 1:.2f}:bs={lut[2] - 1:.2f}"
            filter_parts = [part for part in [crop_filter, color_filter] if part]
            vf_chain = ",".join(filter_parts) + subtitle_filter
            af_chain = "loudnorm=I=-16:LRA=11:TP=-1.5,acompressor=threshold=0.5:ratio=4:attack=5:release=50"

            update_job(req.jobId, {"progress": 55})

            run_ffmpeg(
                "-i",
                str(trimmed),
                "-vf",
                vf_chain,
                "-af",
                af_chain,
                "-c:v",
                "libx264",
                "-crf",
                "20",
                "-preset",
                "fast",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-movflags",
                "+faststart",
                str(output_path),
            )

            update_job(req.jobId, {"progress": 80})

            storage_path = f"exports/{req.workspaceId}/{req.jobId}.mp4"
            output_url = upload_to_storage(output_path, storage_path)

            cap = cv2.VideoCapture(str(output_path))
            duration = cap.get(cv2.CAP_PROP_FRAME_COUNT) / max(cap.get(cv2.CAP_PROP_FPS), 1)
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            cap.release()

            file_size_mb = round(output_path.stat().st_size / (1024 * 1024), 2)
            update_job(req.jobId, {"status": "completed", "progress": 100, "outputUrl": output_url})

            return {
                "outputUrl": output_url,
                "duration": round(duration, 2),
                "fileSizeMb": file_size_mb,
                "resolution": f"{width}x{height}",
            }
        finally:
            cleanup(video_path, output_path, ass_path, *segment_paths)


@app.post("/process/extract-clip")
async def extract_clip(req: ExtractClipRequest):
    async with job_semaphore:
        video_path = TMP / f"kengan-clip-src-{req.jobId}.mp4"
        clip_path = TMP / f"kengan-clip-out-{req.jobId}.mp4"
        update_job(req.jobId, {"status": "processing", "progress": 5})

        try:
            await download_file(req.videoUrl, video_path)
            update_job(req.jobId, {"progress": 20})

            run_ffmpeg(
                "-ss",
                str(req.start),
                "-to",
                str(req.end),
                "-i",
                str(video_path),
                "-c",
                "copy",
                str(clip_path),
            )
            update_job(req.jobId, {"progress": 50})

            crop_filter = detect_face_center(clip_path, req.cropRatio or "9:16")
            if crop_filter:
                cropped_path = TMP / f"kengan-clip-crop-{req.jobId}.mp4"
                run_ffmpeg(
                    "-i",
                    str(clip_path),
                    "-vf",
                    crop_filter,
                    "-c:v",
                    "libx264",
                    "-crf",
                    "20",
                    "-preset",
                    "fast",
                    "-c:a",
                    "copy",
                    str(cropped_path),
                )
                cleanup(clip_path)
                clip_path = cropped_path

            update_job(req.jobId, {"progress": 75})
            storage_path = f"clips/{req.workspaceId}/{req.jobId}.mp4"
            clip_url = upload_to_storage(clip_path, storage_path)

            cap = cv2.VideoCapture(str(clip_path))
            duration = cap.get(cv2.CAP_PROP_FRAME_COUNT) / max(cap.get(cv2.CAP_PROP_FPS), 1)
            cap.release()

            update_job(req.jobId, {"status": "completed", "progress": 100})
            return {"clipUrl": clip_url, "duration": round(duration, 2)}
        finally:
            cleanup(video_path, clip_path)


@app.post("/process/generate-thumbnail")
async def generate_thumbnail(req: ThumbnailRequest):
    async with job_semaphore:
        thumb_path = TMP / f"kengan-thumb-{req.jobId}.jpg"
        try:
            run_ffmpeg(
                "-ss",
                str(req.timestamp),
                "-i",
                req.videoUrl,
                "-frames:v",
                "1",
                "-q:v",
                "2",
                str(thumb_path),
            )
            storage_path = f"thumbnails/{req.workspaceId}/{req.jobId}.jpg"
            thumb_url = upload_to_storage(thumb_path, storage_path)
            return {"thumbnailUrl": thumb_url}
        finally:
            cleanup(thumb_path)


class AutoframeRequest(BaseModel):
    videoPath: str
    targetRatio: str = "9:16"
    layout: str = "auto"  # auto | track | split | fit


@app.post("/process/autoframe")
async def autoframe(req: AutoframeRequest):
    """Plans a subject-following crop path. videoPath is a server-side upload path supplied by the Node API."""
    video_path = Path(req.videoPath)
    if not video_path.is_file():
        raise HTTPException(400, detail={"error": "VIDEO_NOT_FOUND", "message": "Source video is not available to the video service."})
    try:
        parse_ratio(req.targetRatio)
    except ValueError as exc:
        raise HTTPException(400, detail={"error": "INVALID_RATIO", "message": str(exc)})

    async with job_semaphore:
        try:
            return await asyncio.to_thread(plan_crop_path, str(video_path), req.targetRatio, req.layout)
        except ValueError as exc:
            raise HTTPException(422, detail={"error": "AUTOFRAME_FAILED", "message": str(exc)})


class StabilizeRequest(BaseModel):
    inputPath: str
    outputPath: str
    mode: str = "smooth"
    strength: float = 50
    zoomMode: str = "auto"
    zoom: float = 1.1
    edgeFill: str = "zoom"
    correctRotation: bool = True
    # Optional: report progress into manual_edit_jobs/{progressJobId}, mapped onto [progressFrom, progressTo].
    progressJobId: Optional[str] = None
    progressFrom: float = 0
    progressTo: float = 100


@app.post("/process/stabilize")
async def stabilize(req: StabilizeRequest):
    """L1 optimal-path stabilization. Paths are server-side temp files supplied by the Node API."""
    input_path = Path(req.inputPath)
    output_path = Path(req.outputPath)
    if not input_path.is_file():
        raise HTTPException(400, detail={"error": "VIDEO_NOT_FOUND", "message": "Source video is not available to the video service."})
    if output_path.suffix.lower() != ".mp4" or not output_path.parent.is_dir():
        raise HTTPException(400, detail={"error": "INVALID_OUTPUT", "message": "Output must be an .mp4 in an existing folder."})

    options = StabilizeOptions(
        mode=req.mode, strength=req.strength, zoom_mode=req.zoomMode, zoom=req.zoom,
        edge_fill=req.edgeFill, correct_rotation=req.correctRotation,
    )

    last = {"value": -1}

    def report(fraction: float):
        if not req.progressJobId:
            return
        value = int(req.progressFrom + (req.progressTo - req.progressFrom) * fraction)
        if value == last["value"]:
            return
        last["value"] = value
        try:
            firestore.client().collection("manual_edit_jobs").document(req.progressJobId).set({"progress": value}, merge=True)
        except Exception as exc:  # progress is best-effort
            log.warning("Progress update failed: %s", exc)

    async with job_semaphore:
        try:
            return await asyncio.to_thread(stabilize_video, str(input_path), str(output_path), options, report)
        except (ValueError, RuntimeError) as exc:
            raise HTTPException(422, detail={"error": "STABILIZE_FAILED", "message": str(exc)})


# ---------------------------------------------------------------------------
# Video link import (YouTube) for Clips / Repurpose
# ---------------------------------------------------------------------------

YOUTUBE_URL = re.compile(
    r"^https?://(?:www\.|m\.|music\.)?(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|live/|embed/)|youtu\.be/)([A-Za-z0-9_-]{11})"
)
MAX_IMPORT_SECONDS = int(os.getenv("MAX_IMPORT_SECONDS", str(3 * 3600)))
MAX_IMPORT_BYTES = 2 * 1024 ** 3


class DownloadUrlRequest(BaseModel):
    url: str
    # Folder shared with the Node API (its kengan-renders temp folder), so it can use the file directly.
    outputDir: str
    maxHeight: int = 1080


def _download_youtube(url: str, output_dir: Path, max_height: int) -> Dict[str, Any]:
    import yt_dlp  # imported lazily: only this endpoint needs it

    base = {"noplaylist": True, "quiet": True, "no_warnings": True, "noprogress": True}
    with yt_dlp.YoutubeDL(base) as ydl:
        info = ydl.extract_info(url, download=False)
    if info.get("is_live") or info.get("live_status") in ("is_live", "is_upcoming"):
        raise ValueError("Live streams and premieres can't be imported. Try again after the stream has ended.")
    duration = float(info.get("duration") or 0)
    if duration and duration > MAX_IMPORT_SECONDS:
        raise ValueError(f"The video is longer than {MAX_IMPORT_SECONDS // 3600} hours.")

    stem = f"yt_{info.get('id', 'video')}_{int(time.time())}"
    height = max(360, min(int(max_height or 1080), 2160))
    opts = {
        **base,
        "format": f"bv*[height<={height}][ext=mp4]+ba[ext=m4a]/b[height<={height}][ext=mp4]/bv*[height<={height}]+ba/b[height<={height}]/b",
        "merge_output_format": "mp4",
        "outtmpl": str(output_dir / f"{stem}.%(ext)s"),
        "max_filesize": MAX_IMPORT_BYTES,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])
    files = sorted(output_dir.glob(f"{stem}.*"), key=lambda p: p.stat().st_size, reverse=True)
    files = [p for p in files if p.suffix.lower() in (".mp4", ".mkv", ".webm", ".mov")]
    if not files:
        raise ValueError("The video could not be downloaded.")
    return {
        "path": str(files[0]),
        "title": info.get("title") or "YouTube video",
        "durationSec": duration or None,
        "videoId": info.get("id"),
        "channel": info.get("channel") or info.get("uploader"),
        "channelId": info.get("channel_id"),
    }


@app.post("/process/download-url")
async def download_url(req: DownloadUrlRequest):
    """Downloads a YouTube video into outputDir for the Clips pipeline. Only YouTube links are accepted."""
    url = req.url.strip()
    if not YOUTUBE_URL.match(url):
        raise HTTPException(400, detail={"error": "UNSUPPORTED_URL", "message": "Paste a YouTube video link (youtube.com/watch, youtu.be or /shorts)."})
    output_dir = Path(req.outputDir)
    if not output_dir.is_dir():
        raise HTTPException(400, detail={"error": "OUTPUT_DIR_MISSING", "message": "Output folder is not available to the video service."})
    async with job_semaphore:
        try:
            return await asyncio.to_thread(_download_youtube, url, output_dir, req.maxHeight)
        except ValueError as exc:
            raise HTTPException(422, detail={"error": "IMPORT_REJECTED", "message": str(exc)})
        except Exception as exc:  # yt-dlp DownloadError and network failures
            message = re.sub(r"^ERROR:\s*(\[[^\]]+\]\s*)?([A-Za-z0-9_-]{11}:\s*)?", "", str(exc)).strip()
            log.warning("YouTube import failed for %s: %s", url, message)
            raise HTTPException(422, detail={"error": "IMPORT_FAILED", "message": message[:300] or "The video could not be downloaded."})


class YoutubeTranscriptRequest(BaseModel):
    url: str
    plan: str = "creator"
    # Audio transcription is the fallback when a video has no captions; it can be switched off.
    allowTranscription: bool = True


def _caption_text_from_json3(payload: Dict[str, Any]) -> str:
    """YouTube's json3 caption format: events → segs → utf8 text."""
    parts: List[str] = []
    for event in payload.get("events") or []:
        line = "".join(seg.get("utf8", "") for seg in event.get("segs") or []).strip()
        if line and line != "\n":
            parts.append(line)
    text = re.sub(r"\s+", " ", " ".join(parts))
    # Auto captions often repeat the previous line; drop exact consecutive duplicates.
    return re.sub(r"\b(.{20,}?)\s+\1\b", r"\1", text).strip()


def _pick_caption_track(info: Dict[str, Any]) -> Optional[Tuple[str, str, bool]]:
    """Returns (language, json3 url, is_auto) preferring uploaded captions in the video's language, then English."""
    original = (info.get("language") or "").split("-")[0].lower()
    for source, is_auto in ((info.get("subtitles") or {}, False), (info.get("automatic_captions") or {}, True)):
        if not source:
            continue
        langs = list(source.keys())
        preferred = [l for l in langs if original and l.split("-")[0].lower() == original and "orig" in l] + \
            [l for l in langs if original and l.split("-")[0].lower() == original] + \
            [l for l in langs if l.split("-")[0].lower() == "en"] + langs
        # Auto captions list every translation; only the original track is worth using.
        if is_auto:
            preferred = [l for l in preferred if l.endswith("-orig") or l.split("-")[0].lower() in (original, "en")] or preferred[:1]
        for lang in preferred:
            for fmt in source.get(lang) or []:
                if fmt.get("ext") == "json3" and fmt.get("url"):
                    return lang, fmt["url"], is_auto
    return None


def _youtube_transcript(url: str, plan: str, allow_transcription: bool) -> Dict[str, Any]:
    import urllib.request
    import yt_dlp

    base = {"noplaylist": True, "quiet": True, "no_warnings": True, "noprogress": True, "skip_download": True}
    with yt_dlp.YoutubeDL(base) as ydl:
        info = ydl.extract_info(url, download=False)
    if info.get("is_live") or info.get("live_status") in ("is_live", "is_upcoming"):
        raise ValueError("Live streams and premieres can't be read. Try again after the stream has ended.")
    meta = {
        "title": info.get("title") or "YouTube video",
        "channel": info.get("channel") or info.get("uploader"),
        "durationSec": info.get("duration"),
        "description": (info.get("description") or "")[:2000],
        "videoId": info.get("id"),
    }

    track = _pick_caption_track(info)
    if track:
        lang, caption_url, is_auto = track
        with urllib.request.urlopen(caption_url, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        text = _caption_text_from_json3(payload)
        if len(text) >= 80:
            return {**meta, "text": text[:20000], "language": lang, "source": "auto-captions" if is_auto else "captions"}

    if not allow_transcription:
        raise ValueError("This video has no captions to read.")
    duration = float(info.get("duration") or 0)
    if duration and duration > 2 * 3600:
        raise ValueError("This video has no captions, and it is too long to transcribe (over 2 hours).")

    # No captions: download the audio only and transcribe it.
    stem = TMP / f"yt_audio_{info.get('id', 'video')}_{int(time.time())}"
    opts = {**base, "skip_download": False, "format": "bestaudio[ext=m4a]/bestaudio/best", "outtmpl": str(stem) + ".%(ext)s"}
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])
    downloaded = sorted(TMP.glob(stem.name + ".*"))
    if not downloaded:
        raise ValueError("The audio could not be downloaded.")
    wav = stem.with_suffix(".wav")
    try:
        run_ffmpeg("-i", str(downloaded[0]), "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", str(wav))
        result = local_transcribe(wav, plan)
        words = [w.get("text", "") for w in result.get("words", [])]
        text = re.sub(r"\s+([,.!?;:])", r"\1", " ".join(words)).strip()
        if len(text) < 80:
            raise ValueError("No speech was found in this video.")
        return {**meta, "text": text[:20000], "language": result.get("language"), "source": "transcription"}
    finally:
        cleanup(*downloaded, wav)


@app.post("/process/youtube-transcript")
async def youtube_transcript(req: YoutubeTranscriptRequest):
    """Text of a YouTube video for Repurpose: its captions, or a transcription of its audio."""
    url = req.url.strip()
    if not YOUTUBE_URL.match(url):
        raise HTTPException(400, detail={"error": "UNSUPPORTED_URL", "message": "Paste a YouTube video link (youtube.com/watch, youtu.be or /shorts)."})
    async with job_semaphore:
        try:
            return await asyncio.to_thread(_youtube_transcript, url, req.plan, req.allowTranscription)
        except ValueError as exc:
            raise HTTPException(422, detail={"error": "TRANSCRIPT_REJECTED", "message": str(exc)})
        except Exception as exc:
            message = re.sub(r"^ERROR:\s*(\[[^\]]+\]\s*)?([A-Za-z0-9_-]{11}:\s*)?", "", str(exc)).strip()
            log.warning("YouTube transcript failed for %s: %s", url, message)
            raise HTTPException(422, detail={"error": "TRANSCRIPT_FAILED", "message": message[:300] or "The video could not be read."})


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "kengansocial-video",
        "version": "2.0.0",
        "transcriptionProvider": DEFAULT_TRANSCRIPTION_PROVIDER,
        "clipAnalysisProvider": DEFAULT_CLIP_ANALYSIS_PROVIDER,
    }
