"""
Editing-style analysis for AI Edit.

analyze_reference() measures how a finished video is edited: pacing (shot lengths, cuts per
minute, punch-in cuts, zoom motion), colour grade, burned-in captions (position, size, colours,
words per caption, box or outline), faces and the hook (opening text, early cuts).

analyze_footage() measures raw footage in one decoding pass: colour statistics (to match the
reference grade) and a face track with a per-face mouth-activity score, so punch-ins can aim at
whoever is talking in a two-person shot.

Everything is measured from pixels with OpenCV; no frames leave the server.
"""
from __future__ import annotations

import base64
import json
import logging
import math
import subprocess
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Tuple

import cv2
import numpy as np

from autoframe import detect_faces

log = logging.getLogger("kengan.style")


# ---------------------------------------------------------------------------
# Decoding
# ---------------------------------------------------------------------------

def probe_video(path: Path) -> Dict[str, Any]:
    """Display size (rotation applied), frame rate, duration and whether there is audio."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
        capture_output=True, text=True, timeout=60,
    )
    data = json.loads(out.stdout or "{}")
    video = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), {})
    has_audio = any(s.get("codec_type") == "audio" for s in data.get("streams", []))
    width, height = int(video.get("width") or 0), int(video.get("height") or 0)
    rotation = 0
    for side in video.get("side_data_list") or []:
        if "rotation" in side:
            rotation = int(side["rotation"])
    rotation = int(video.get("tags", {}).get("rotate", rotation) or 0)
    if abs(rotation) % 180 == 90:
        width, height = height, width
    num, _, den = str(video.get("avg_frame_rate") or "30/1").partition("/")
    fps = float(num) / float(den or 1) if float(den or 1) else 30.0
    duration = float(data.get("format", {}).get("duration") or video.get("duration") or 0)
    return {"width": width, "height": height, "fps": round(fps, 3), "duration": duration, "hasAudio": has_audio}


def iter_frames(path: Path, fps: float, width: int, info: Dict[str, Any]) -> Iterator[Tuple[float, np.ndarray]]:
    """Frames at `fps`, scaled to `width` pixels wide, as (seconds, BGR image)."""
    src_w, src_h = info["width"] or 16, info["height"] or 9
    height = max(2, int(round(width * src_h / src_w / 2)) * 2)
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path),
        "-vf", f"fps={fps},scale={width}:{height}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    size = width * height * 3
    index = 0
    try:
        while True:
            buf = proc.stdout.read(size) if proc.stdout else b""
            if len(buf) < size:
                break
            yield index / fps, np.frombuffer(buf, dtype=np.uint8).reshape(height, width, 3)
            index += 1
    finally:
        if proc.stdout:
            proc.stdout.close()
        proc.kill()
        proc.wait()


# ---------------------------------------------------------------------------
# Measurements
# ---------------------------------------------------------------------------

def frame_color(img: np.ndarray) -> Dict[str, float]:
    """Brightness, contrast, saturation and white balance of one frame (all 0..1 scales)."""
    small = cv2.resize(img, (160, max(2, int(160 * img.shape[0] / img.shape[1]))), interpolation=cv2.INTER_AREA)
    lab = cv2.cvtColor(small, cv2.COLOR_BGR2LAB).astype(np.float32)
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV).astype(np.float32)
    L = lab[..., 0] / 255.0
    return {
        "brightness": float(L.mean()),
        "contrast": float(L.std()),
        "saturation": float((hsv[..., 1] / 255.0).mean()),
        "warmth": float((lab[..., 2].mean() - 128.0) / 128.0),  # +yellow / -blue
        "tint": float((lab[..., 1].mean() - 128.0) / 128.0),  # +magenta / -green
        "black": float(np.percentile(L, 5)),
        "white": float(np.percentile(L, 95)),
    }


def average(stats: List[Dict[str, float]]) -> Dict[str, float]:
    if not stats:
        return {}
    return {k: round(float(np.median([s[k] for s in stats])), 4) for k in stats[0]}


def glyph_mask(img: np.ndarray) -> np.ndarray:
    """Pixels that look like overlay text: bright white or vivid colour sitting right next to very
    dark pixels (the outline, shadow or box that keeps captions readable on any footage)."""
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    s, v = hsv[..., 1], hsv[..., 2]
    fill = ((v >= 215) & (s <= 70)) | ((v >= 170) & (s >= 140))
    dark = (v <= 55).astype(np.uint8)
    near_dark = cv2.dilate(dark, np.ones((3, 3), np.uint8)) > 0
    return ((fill & near_dark) * 255).astype(np.uint8)


def find_text_boxes(img: np.ndarray, mask: np.ndarray) -> List[Dict[str, Any]]:
    """Horizontally centred text lines: [{y, h, w, box}] with y/h/w as fractions of the frame."""
    H, W = img.shape[:2]
    joined = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (max(7, W // 22), max(3, H // 120))))
    contours, _ = cv2.findContours(joined, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boxes = []
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        if not (0.018 * H <= h <= 0.12 * H and 0.06 * W <= w <= 0.95 * W and w >= 1.4 * h):
            continue
        if abs(x + w / 2 - W / 2) > 0.16 * W:
            continue
        density = cv2.countNonZero(mask[y:y + h, x:x + w]) / float(w * h)
        if density < 0.06:
            continue
        boxes.append({"y": (y + h / 2) / H, "h": h / H, "w": w / W, "box": (x, y, w, h)})
    return boxes


def text_colors(img: np.ndarray, mask: np.ndarray, box: Tuple[int, int, int, int]) -> Dict[str, Any]:
    """Text colour, highlight colour (a coloured active word), and box-or-outline treatment."""
    x, y, w, h = box
    region = img[y:y + h, x:x + w]
    glyphs = mask[y:y + h, x:x + w] > 0
    if region.size == 0 or glyphs.sum() < 10:
        return {}
    hsv = cv2.cvtColor(region, cv2.COLOR_BGR2HSV)
    sat = hsv[..., 1][glyphs]
    px = region[glyphs]
    to_hex = lambda bgr: "#%02x%02x%02x" % (int(bgr[2]), int(bgr[1]), int(bgr[0]))
    plain = px[sat < 90]
    vivid = px[sat >= 140]
    out: Dict[str, Any] = {"color": to_hex(np.median(plain, axis=0)) if len(plain) else to_hex(np.median(px, axis=0))}
    if len(vivid) >= 0.1 * len(px):
        out["highlight"] = to_hex(np.median(vivid, axis=0))
        if len(plain) < 0.1 * len(px):
            out["color"] = out["highlight"]  # the whole caption is coloured
    # Box: the space between the letters is dark and even. Outline: dark only right at the glyph edges.
    between = hsv[..., 2][~cv2.dilate(glyphs.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)]
    out["background"] = bool(len(between) > 20 and between.mean() < 60 and between.std() < 30)
    out["outline"] = not out["background"]
    return out


def orb_scale(a: np.ndarray, b: np.ndarray, orb) -> Optional[Tuple[float, float]]:
    """Relative zoom from frame a to frame b (>1 = b is zoomed in) and the inlier ratio."""
    ka, da = orb.detectAndCompute(a, None)
    kb, db = orb.detectAndCompute(b, None)
    if da is None or db is None or len(ka) < 20 or len(kb) < 20:
        return None
    matches = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True).match(da, db)
    if len(matches) < 20:
        return None
    pa = np.float32([ka[m.queryIdx].pt for m in matches])
    pb = np.float32([kb[m.trainIdx].pt for m in matches])
    matrix, inliers = cv2.estimateAffinePartial2D(pa, pb, method=cv2.RANSAC, ransacReprojThreshold=4.0)
    if matrix is None or inliers is None:
        return None
    scale = math.hypot(matrix[0, 0], matrix[1, 0])
    return float(scale), float(inliers.mean())


def keyframe(img: np.ndarray, width: int = 360) -> str:
    h = max(2, int(width * img.shape[0] / img.shape[1]))
    ok, buf = cv2.imencode(".jpg", cv2.resize(img, (width, h), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 70])
    return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode() if ok else ""


def summarize_text(rows: List[Dict[str, Any]], total: int, sample_fps: float, W: int, H: int) -> Tuple[Dict[str, Any], bool]:
    """Groups text lines into horizontal bands. The caption band is the one present in many frames
    whose content keeps changing; static bands (logos, shirt prints, lower thirds) are ignored."""
    bands: Dict[int, List[Dict[str, Any]]] = {}
    for r in rows:
        bands.setdefault(int(r["y"] / 0.06), []).append(r)
    best = None
    for key, items in bands.items():
        # Neighbouring bands belong together (captions move a little line to line).
        merged = sorted(items + bands.get(key - 1, []) + bands.get(key + 1, []), key=lambda r: r["t"])
        frames_with = len({r["t"] for r in merged})
        changes = 0
        comparisons = 0
        last = None
        for r in merged:
            if last is not None and 0 < r["t"] - last["t"] <= 1.0 / sample_fps + 1e-6:
                comparisons += 1
                if float(np.mean(cv2.absdiff(r["sig"], last["sig"]))) > 22 or abs(r["w"] - last["w"]) > 0.05:
                    changes += 1
            last = r
        change_rate = changes / max(1, comparisons)
        share = frames_with / max(1, total)
        if share < 0.2 or change_rate < 0.15:
            continue
        score = share * (0.5 + change_rate)
        if best is None or score > best[0]:
            best = (score, merged, share, change_rate, changes, frames_with)

    caption: Dict[str, Any] = {"present": best is not None}
    hook = any(r["t"] < 3.0 and r["y"] < 0.4 for r in rows)
    if best is None:
        caption["share"] = 0.0
        return caption, hook
    _, items, share, change_rate, changes, frames_with = best
    styles = [r["colors"] for r in items if r["colors"]]
    highlight = [st["highlight"] for st in styles if st.get("highlight")]
    colors = [st.get("color", "#ffffff") for st in styles]
    rel_h = float(np.median([r["h"] for r in items]))
    rel_w = float(np.median([r["w"] for r in items]))
    chars = rel_w * W / max(1.0, rel_h * H * 0.6)
    caption.update({
        "share": round(share, 3),
        "y": round(float(np.median([r["y"] for r in items])), 3),
        "textHeight": round(rel_h, 4),
        "widthShare": round(rel_w, 3),
        "estimatedWordsPerCaption": int(min(8, max(1, round(chars / 6.0)))),
        "changesPerSecond": round(changes / max(1.0, frames_with / sample_fps), 3),
        "color": max(set(colors), key=colors.count) if colors else "#ffffff",
        "highlight": max(set(highlight), key=highlight.count) if len(highlight) >= max(2, len(styles) // 6) else None,
        "background": sum(1 for st in styles if st.get("background")) > len(styles) / 2,
        "outline": sum(1 for st in styles if st.get("outline")) >= len(styles) / 2,
    })
    # Hook text: a separate band near the top in the opening seconds.
    caption_y = caption["y"]
    hook = any(r["t"] < 3.0 and r["y"] < 0.4 and abs(r["y"] - caption_y) > 0.08 for r in rows)
    return caption, hook


# ---------------------------------------------------------------------------
# Reference video
# ---------------------------------------------------------------------------

def analyze_reference(path: Path, scene_boundaries: List[float]) -> Dict[str, Any]:
    info = probe_video(path)
    duration = info["duration"] or 1.0
    sample_fps = 4.0 if duration <= 180 else 2.0 if duration <= 600 else 1.0
    cuts = sorted(b for b in scene_boundaries if 0.05 < b < duration - 0.05)
    shots = np.diff([0.0, *cuts, duration]) if cuts else np.array([duration])

    orb = cv2.ORB_create(500)
    colors: List[Dict[str, float]] = []
    text_rows: List[Dict[str, Any]] = []  # every centred text line seen, for band clustering
    hook_text = False
    faces_seen = 0
    face_heights: List[float] = []
    face_x: List[float] = []
    zoom_frames = 0
    pairs = 0
    punch_ins = 0
    motion: List[float] = []
    frames: List[Tuple[float, np.ndarray]] = []
    prev: Optional[Tuple[float, np.ndarray, np.ndarray]] = None
    total = 0

    for t, img in iter_frames(path, sample_fps, 360, info):
        total += 1
        H, W = img.shape[:2]
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        colors.append(frame_color(img))
        if len(frames) < 64:
            frames.append((t, img))

        mask = glyph_mask(img)
        for tb in find_text_boxes(img, mask):
            x, y, w, h = tb["box"]
            text_rows.append({
                "t": t,
                "y": tb["y"], "h": tb["h"], "w": tb["w"],
                "sig": cv2.resize(mask[y:y + h, x:x + w], (48, 8), interpolation=cv2.INTER_AREA),
                "colors": text_colors(img, mask, tb["box"]) if len(text_rows) < 400 else {},
            })

        faces = detect_faces(img, gray)
        if faces:
            faces_seen += 1
            fx, fy, fw, fh, _ = max(faces, key=lambda f: f[2] * f[3])
            face_heights.append(fh / H)
            face_x.append((fx + fw / 2) / W)

        if prev is not None:
            pt, pimg, pgray = prev
            cut_between = any(pt < c <= t for c in cuts)
            if cut_between:
                # A cut to the same shot, zoomed in: a "punch-in" jump cut.
                r = orb_scale(pgray, gray, orb)
                if r and r[1] >= 0.35 and r[0] >= 1.07:
                    punch_ins += 1
            else:
                pairs += 1
                motion.append(float(np.mean(cv2.absdiff(pgray, gray))) / 255.0)
                r = orb_scale(pgray, gray, orb)
                if r and r[1] >= 0.4 and abs(math.log(max(r[0], 1e-3))) * sample_fps >= 0.04:
                    zoom_frames += 1
        prev = (t, img, gray)

    picks = [frames[int(i)][1] for i in np.linspace(0, len(frames) - 1, num=min(4, len(frames)))] if frames else []
    caption, hook_text = summarize_text(text_rows, total, sample_fps, W if total else 360, H if total else 640)

    return {
        "durationSec": round(duration, 2),
        "width": info["width"],
        "height": info["height"],
        "fps": info["fps"],
        "pacing": {
            "shots": int(len(shots)),
            "avgShotSec": round(float(np.mean(shots)), 2),
            "medianShotSec": round(float(np.median(shots)), 2),
            "cutsPerMinute": round(len(cuts) / (duration / 60.0), 2),
            "punchInsPerMinute": round(punch_ins / (duration / 60.0), 2),
            "zoomMotionShare": round(zoom_frames / max(1, pairs), 3),
            "motion": round(float(np.mean(motion)) if motion else 0.0, 4),
            "cutsInFirst3s": int(sum(1 for c in cuts if c <= 3.0)),
        },
        "color": average(colors),
        "captions": caption,
        "faces": {
            "share": round(faces_seen / max(1, total), 3),
            "medianHeight": round(float(np.median(face_heights)), 3) if face_heights else None,
            "medianX": round(float(np.median(face_x)), 3) if face_x else None,
        },
        "hook": {"textOverlay": hook_text},
        "keyframes": [k for k in (keyframe(img) for img in picks) if k],
    }


# ---------------------------------------------------------------------------
# Raw footage
# ---------------------------------------------------------------------------

def analyze_footage(path: Path) -> Dict[str, Any]:
    """Colour statistics plus a face track: [{t, faces: [{cx, cy, w, h, act}]}] in 0..1 units."""
    info = probe_video(path)
    duration = info["duration"] or 1.0
    sample_fps = 3.0 if duration <= 20 * 60 else 2.0 if duration <= 60 * 60 else 1.0
    width = 640
    colors: List[Dict[str, float]] = []
    color_every = max(1, int(round(sample_fps * max(1.0, duration / 120.0))))
    samples: List[Dict[str, Any]] = []
    prev_gray: Optional[np.ndarray] = None
    index = 0

    for t, img in iter_frames(path, sample_fps, width, info):
        H, W = img.shape[:2]
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        if index % color_every == 0:
            colors.append(frame_color(img))
        faces = []
        for fx, fy, fw, fh, score in detect_faces(img, gray):
            act = 0.0
            if prev_gray is not None:
                # Mouth activity: change in the lower third of the face since the previous sample.
                x0, x1 = int(max(0, fx + fw * 0.2)), int(min(W, fx + fw * 0.8))
                y0, y1 = int(max(0, fy + fh * 0.62)), int(min(H, fy + fh * 1.0))
                if x1 - x0 > 4 and y1 - y0 > 4:
                    act = float(np.mean(cv2.absdiff(gray[y0:y1, x0:x1], prev_gray[y0:y1, x0:x1]))) / 255.0
            faces.append({
                "cx": round((fx + fw / 2) / W, 4),
                "cy": round((fy + fh / 2) / H, 4),
                "w": round(fw / W, 4),
                "h": round(fh / H, 4),
                "act": round(act, 4),
            })
        faces.sort(key=lambda f: -f["w"] * f["h"])
        samples.append({"t": round(t, 2), "faces": faces[:4]})
        prev_gray = gray
        index += 1

    return {
        "durationSec": round(duration, 2),
        "width": info["width"],
        "height": info["height"],
        "fps": info["fps"],
        "hasAudio": info["hasAudio"],
        "color": average(colors),
        "faceTrack": {"fps": sample_fps, "samples": samples},
    }
