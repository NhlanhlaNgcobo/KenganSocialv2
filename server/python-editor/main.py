"""
KenganSocial Video Editor — Python Microservice
FastAPI backend for video processing using FFmpeg.
Runs on port 8000 alongside the main Node.js server on port 5000.
"""

from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, List
import os, uuid, json, shutil, subprocess, base64, tempfile
from pathlib import Path

# ═══════════════════════════════════════════════════════════
# APP SETUP
# ═══════════════════════════════════════════════════════════

app = FastAPI(title="KenganSocial Video Editor")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).parent
UPLOAD_DIR = BASE_DIR / "uploads"
RENDER_DIR = BASE_DIR / "renders"
THUMB_DIR = BASE_DIR / "thumbnails"

for d in [UPLOAD_DIR, RENDER_DIR, THUMB_DIR]:
    d.mkdir(exist_ok=True)

# In-memory stores
media_store: dict = {}
job_store: dict = {}

# ═══════════════════════════════════════════════════════════
# PYDANTIC MODELS
# ═══════════════════════════════════════════════════════════

class TextOverlay(BaseModel):
    text: str = "Text"
    x: int = 50
    y: int = 80
    size: int = 32
    color: str = "#ffffff"
    start: float = 0
    end: float = 3

class TransformConfig(BaseModel):
    scale: float = 100
    x: float = 0
    y: float = 0
    rotate: float = 0

class ClipConfig(BaseModel):
    source: str
    start: Optional[float] = None
    end: Optional[float] = None
    speed: Optional[float] = 1.0
    volume: Optional[float] = 1.0
    filter: Optional[str] = None
    transform: Optional[TransformConfig] = None
    textOverlays: Optional[List[TextOverlay]] = []
    transition: Optional[str] = None

class EditConfig(BaseModel):
    clips: List[ClipConfig]
    exportFormat: Optional[str] = "tiktok"

# ═══════════════════════════════════════════════════════════
# FFMPEG UTILITIES
# ═══════════════════════════════════════════════════════════

def run_ffprobe(filepath: str) -> dict:
    cmd = ["ffprobe", "-v", "quiet", "-print_format", "json",
           "-show_format", "-show_streams", filepath]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {result.stderr[:300]}")
    return json.loads(result.stdout)

def run_ffmpeg(args: list, desc: str = ""):
    cmd = ["ffmpeg", "-y"] + args
    print(f"[PY-Editor] {desc}: ffmpeg {' '.join(args[:6])}...")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg error ({desc}): {result.stderr[-400:]}")
    return result

def get_duration(filepath: str) -> float:
    info = run_ffprobe(filepath)
    return float(info["format"].get("duration", 0))

def safe_fps(fps_str: str) -> float:
    try:
        if "/" in fps_str:
            n, d = fps_str.split("/")
            return round(float(n) / float(d), 2)
        return float(fps_str)
    except Exception:
        return 30.0

# ═══════════════════════════════════════════════════════════
# THUMBNAIL GENERATION
# ═══════════════════════════════════════════════════════════

def generate_thumbnails(filepath: str, upload_id: str, count: int = 20) -> list:
    duration = get_duration(filepath)
    if duration <= 0:
        return []

    interval = duration / count
    thumbs = []

    for i in range(count):
        ts = i * interval
        out = THUMB_DIR / f"{upload_id}_{i:03d}.jpg"
        try:
            run_ffmpeg([
                "-ss", str(ts), "-i", filepath,
                "-vframes", "1",
                "-vf", "scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2",
                "-q:v", "8", str(out),
            ], f"thumb {i}/{count}")
            thumbs.append(f"/thumbnails/{upload_id}_{i:03d}.jpg")
        except Exception as e:
            print(f"  thumb {i} failed: {e}")

    return thumbs

# ═══════════════════════════════════════════════════════════
# API ENDPOINTS
# ═══════════════════════════════════════════════════════════

@app.post("/api/editor/upload")
async def upload_video(video: UploadFile = File(...)):
    uid = str(uuid.uuid4())
    ext = Path(video.filename).suffix or ".mp4"
    fp = UPLOAD_DIR / f"{uid}{ext}"

    with open(fp, "wb") as f:
        shutil.copyfileobj(video.file, f)

    info = run_ffprobe(str(fp))
    vs = next((s for s in info.get("streams", []) if s["codec_type"] == "video"), {})
    has_audio = any(s["codec_type"] == "audio" for s in info.get("streams", []))

    duration = float(info["format"].get("duration", 0))
    thumbs = generate_thumbnails(str(fp), uid, count=min(30, max(8, int(duration))))

    meta = {
        "uploadId": uid,
        "filename": video.filename,
        "filepath": str(fp),
        "duration": duration,
        "width": int(vs.get("width", 0)),
        "height": int(vs.get("height", 0)),
        "fps": safe_fps(vs.get("r_frame_rate", "30/1")),
        "hasAudio": has_audio,
        "size": int(info["format"].get("size", 0)),
        "thumbnails": thumbs,
    }
    media_store[uid] = meta
    return meta

@app.get("/api/editor/media")
async def list_media():
    return {"media": list(media_store.values())}

@app.get("/api/editor/frame/{upload_id}")
async def get_frame(upload_id: str, time: float = 0):
    if upload_id not in media_store:
        raise HTTPException(404, "Upload not found")
    fp = media_store[upload_id]["filepath"]
    out = THUMB_DIR / f"frame_{upload_id}_{time:.2f}.jpg"
    run_ffmpeg(["-ss", str(time), "-i", fp, "-vframes", "1",
                "-vf", "scale=640:-2", "-q:v", "5", str(out)], "frame")
    with open(out, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    return {"frame": f"data:image/jpeg;base64,{b64}"}

@app.post("/api/editor/process")
async def process_edit(config: EditConfig, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    job_store[job_id] = {"jobId": job_id, "status": "processing",
                          "progress": 0, "downloadUrl": None, "error": None}
    background_tasks.add_task(execute_pipeline, job_id, config)
    return {"jobId": job_id, "status": "processing"}

@app.get("/api/editor/status/{job_id}")
async def get_status(job_id: str):
    if job_id not in job_store:
        raise HTTPException(404, "Job not found")
    return job_store[job_id]

@app.get("/api/editor/download/{filename}")
async def download(filename: str):
    fp = RENDER_DIR / filename
    if not fp.exists():
        raise HTTPException(404, "File not found")
    return FileResponse(str(fp), media_type="video/mp4", filename=filename)

# Serve thumbnail images
app.mount("/thumbnails", StaticFiles(directory=str(THUMB_DIR)), name="thumbnails")

# ═══════════════════════════════════════════════════════════
# VIDEO OPERATIONS
# ═══════════════════════════════════════════════════════════

FILTER_PRESETS = {
    "vivid": "eq=saturation=1.5:contrast=1.1:brightness=0.05",
    "fade": "eq=saturation=0.6:brightness=0.1:contrast=0.9",
    "noir": "hue=s=0,eq=contrast=1.3:brightness=-0.05",
    "warm": "colorbalance=rs=0.15:gs=0.05:bs=-0.1",
    "cool": "colorbalance=rs=-0.1:gs=0.0:bs=0.15",
    "drama": "eq=contrast=1.4:brightness=-0.08:saturation=1.2,unsharp=5:5:1.0",
    "neon": "eq=saturation=2.0:contrast=1.3:brightness=0.1,hue=h=10",
    "retro": "eq=saturation=0.8:contrast=1.1,colorbalance=rs=0.12:bs=-0.08",
    "cinema": "colorbalance=rs=0.1:gs=-0.05:bs=-0.1,eq=contrast=1.2",
    "vibrant": "eq=saturation=1.8:contrast=1.15:brightness=0.03",
}

EXPORT_PRESETS = {
    "tiktok":    {"w": 1080, "h": 1920},
    "reels":     {"w": 1080, "h": 1920},
    "instagram": {"w": 1080, "h": 1080},
    "youtube":   {"w": 1920, "h": 1080},
}

def _out(prefix: str) -> str:
    return str(RENDER_DIR / f"{prefix}_{uuid.uuid4().hex[:8]}.mp4")

def trim_clip(inp: str, start: float, end: float) -> str:
    out = _out("trim")
    run_ffmpeg(["-ss", str(start), "-i", inp, "-t", str(end - start),
                "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out], "Trim")
    return out

def change_speed(inp: str, speed: float) -> str:
    out = _out("speed")
    pts = round(1.0 / speed, 4)
    atempo = _atempo_chain(speed)
    af = ",".join(f"atempo={t}" for t in atempo)
    run_ffmpeg(["-i", inp, "-filter_complex",
                f"[0:v]setpts={pts}*PTS[v];[0:a]{af}[a]",
                "-map", "[v]", "-map", "[a]",
                "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out],
               f"Speed {speed}x")
    return out

def _atempo_chain(speed: float) -> list:
    chain, r = [], speed
    if r < 0.5:
        while r < 0.5: chain.append(0.5); r /= 0.5
    elif r > 2.0:
        while r > 2.0: chain.append(2.0); r /= 2.0
    chain.append(round(r, 4))
    return chain

def adjust_volume(inp: str, vol: float) -> str:
    out = _out("vol")
    run_ffmpeg(["-i", inp, "-c:v", "copy", "-af", f"volume={vol}",
                "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out], "Volume")
    return out

def apply_filter(inp: str, name: str) -> str:
    chain = FILTER_PRESETS.get(name.lower())
    if not chain:
        raise ValueError(f"Unknown filter: {name}")
    out = _out("filter")
    run_ffmpeg(["-i", inp, "-vf", chain,
                "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                "-c:a", "copy", "-movflags", "+faststart", out], f"Filter:{name}")
    return out

def add_text_overlays(inp: str, overlays: list) -> str:
    filters = []
    for ov in overlays:
        txt = ov.get("text", "").replace("'", "\\'").replace(":", "\\:")
        filters.append(
            f"drawtext=text='{txt}':fontsize={ov.get('size',32)}"
            f":fontcolor={ov.get('color','#ffffff')}"
            f":x={ov.get('x',50)}:y={ov.get('y',80)}"
            f":enable='between(t,{ov.get('start',0)},{ov.get('end',9999)})'"
        )
    out = _out("text")
    run_ffmpeg(["-i", inp, "-vf", ",".join(filters),
                "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                "-c:a", "copy", "-movflags", "+faststart", out], "Text")
    return out

def apply_transform(inp: str, t: dict) -> str:
    scale = t.get("scale", 100) / 100.0
    rotate = t.get("rotate", 0)
    vf = []
    if rotate != 0:
        rad = rotate * 3.14159265 / 180
        vf.append(f"rotate={rad}:c=black@0")
    if scale != 1.0:
        vf.append(f"scale=iw*{scale}:ih*{scale}")
    if not vf:
        return inp
    out = _out("transform")
    run_ffmpeg(["-i", inp, "-vf", ",".join(vf),
                "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                "-c:a", "copy", "-movflags", "+faststart", out], "Transform")
    return out

def merge_clips(paths: list) -> str:
    if len(paths) == 1:
        return paths[0]
    out = _out("merged")
    list_file = RENDER_DIR / f"concat_{uuid.uuid4().hex[:6]}.txt"
    list_file.write_text("\n".join(f"file '{p.replace(chr(92), '/')}'" for p in paths))
    run_ffmpeg(["-f", "concat", "-safe", "0", "-i", str(list_file),
                "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out], "Merge")
    try: list_file.unlink()
    except Exception: pass
    return out

def apply_transition(a: str, b: str, ttype: str = "fade", dur: float = 1.0) -> str:
    tmap = {"fade":"fade","slide":"slideleft","wipe":"wiperight",
            "zoom":"smoothup","dissolve":"dissolve"}
    xf = tmap.get(ttype, "fade")
    offset = max(0, get_duration(a) - dur)
    out = _out("trans")
    run_ffmpeg(["-i", a, "-i", b, "-filter_complex",
                f"[0:v][1:v]xfade=transition={xf}:duration={dur}:offset={offset}[v];"
                f"[0:a][1:a]acrossfade=d={dur}[a]",
                "-map", "[v]", "-map", "[a]",
                "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out],
               f"Transition:{ttype}")
    return out

def export_for_platform(inp: str, fmt: str) -> str:
    p = EXPORT_PRESETS.get(fmt.lower())
    if not p:
        raise ValueError(f"Unknown format: {fmt}")
    out = _out(f"export_{fmt}")
    sf = f"scale={p['w']}:{p['h']}:force_original_aspect_ratio=decrease,pad={p['w']}:{p['h']}:(ow-iw)/2:(oh-ih)/2:black"
    run_ffmpeg(["-i", inp, "-vf", sf,
                "-c:v", "libx264", "-preset", "slow", "-crf", "20",
                "-profile:v", "high", "-c:a", "aac", "-b:a", "192k",
                "-ar", "48000", "-movflags", "+faststart", "-pix_fmt", "yuv420p", out],
               f"Export:{fmt}")
    return out

# ═══════════════════════════════════════════════════════════
# PIPELINE ORCHESTRATOR
# ═══════════════════════════════════════════════════════════

def execute_pipeline(job_id: str, config: EditConfig):
    job = job_store[job_id]
    try:
        clips = config.clips
        total = len(clips) * 5 + 2
        step = [0]

        def tick():
            step[0] += 1
            job["progress"] = min(int(step[0] / total * 100), 95)

        processed = []
        for clip in clips:
            meta = media_store.get(clip.source)
            if not meta:
                raise ValueError(f"Source not found: {clip.source}")
            p = meta["filepath"]

            if clip.start is not None and clip.end is not None:
                p = trim_clip(p, clip.start, clip.end)
            tick()

            if clip.speed and clip.speed != 1.0:
                p = change_speed(p, clip.speed)
            tick()

            if clip.volume is not None and clip.volume != 1.0:
                p = adjust_volume(p, clip.volume)
            tick()

            if clip.filter and clip.filter != "none":
                p = apply_filter(p, clip.filter)
            tick()

            if clip.textOverlays:
                overlays = [ov.model_dump() for ov in clip.textOverlays]
                if overlays:
                    p = add_text_overlays(p, overlays)
            tick()

            if clip.transform:
                p = apply_transform(p, clip.transform.model_dump())

            processed.append({"path": p, "transition": clip.transition})

        # Merge / transitions
        if len(processed) == 1:
            final = processed[0]["path"]
        else:
            final = processed[0]["path"]
            for i in range(1, len(processed)):
                tr = processed[i].get("transition")
                if tr and tr != "none":
                    final = apply_transition(final, processed[i]["path"], tr)
                else:
                    final = merge_clips([final, processed[i]["path"]])
        tick()

        # Export
        final = export_for_platform(final, config.exportFormat or "tiktok")
        tick()

        filename = Path(final).name
        job.update({
            "status": "completed", "progress": 100,
            "downloadUrl": f"/api/editor/download/{filename}",
        })
        print(f"[PY-Editor] Job {job_id} complete → {filename}")
    except Exception as e:
        print(f"[PY-Editor] Job {job_id} FAILED: {e}")
        job.update({"status": "failed", "error": str(e)})

# ═══════════════════════════════════════════════════════════
# STARTUP
# ═══════════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn
    print("🎬 KenganSocial Video Editor — Python Service")
    print(f"   Uploads: {UPLOAD_DIR}")
    print(f"   Renders: {RENDER_DIR}")
    uvicorn.run(app, host="0.0.0.0", port=8000)
