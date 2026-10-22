"""
Thumbnail candidates: samples frames from a video and scores how likely each is to make a
high-converting thumbnail, then returns the best few (spread out in time).

What scores well (what tends to get clicks on YouTube and TikTok covers):
  - a large, clear, front-on face (YuNet face detector with landmarks), ideally with an
    expressive mouth (wide smile / open mouth widens the mouth relative to the eyes)
  - sharpness (variance of the Laplacian, on the face if there is one)
  - good exposure and contrast, and colour (Hasler-Suesstrunk colourfulness)
Frames without faces (screen recordings, products) are scored on the image qualities only.
"""
from __future__ import annotations

import math
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np

YUNET_MODEL = Path(__file__).resolve().parent / "models" / "face_detection_yunet_2023mar.onnx"
SCORE_WIDTH = 640
_detector = None
_detector_size: Optional[Tuple[int, int]] = None


def _faces(img: np.ndarray) -> List[np.ndarray]:
    """YuNet rows: x, y, w, h, 5 landmarks (right eye, left eye, nose, right mouth, left mouth), score."""
    global _detector, _detector_size
    if not YUNET_MODEL.exists() or not hasattr(cv2, "FaceDetectorYN"):
        return []
    h, w = img.shape[:2]
    if _detector is None:
        _detector = cv2.FaceDetectorYN.create(str(YUNET_MODEL), "", (w, h), 0.7, 0.3, 5000)
        _detector_size = (w, h)
    elif _detector_size != (w, h):
        _detector.setInputSize((w, h))
        _detector_size = (w, h)
    _, found = _detector.detect(img)
    return [] if found is None else [row for row in found]


def _colourfulness(img: np.ndarray) -> float:
    b, g, r = [c.astype(np.float32) for c in cv2.split(img)]
    rg = np.abs(r - g)
    yb = np.abs(0.5 * (r + g) - b)
    return float(math.sqrt(rg.std() ** 2 + yb.std() ** 2) + 0.3 * math.sqrt(rg.mean() ** 2 + yb.mean() ** 2))


def score_frame(img: np.ndarray) -> Dict[str, Any]:
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    faces = _faces(img)
    reasons: List[str] = []

    face_score = 0.0
    expression = 0.0
    face_box = None
    region = gray
    if faces:
        best = max(faces, key=lambda f: f[2] * f[3] * f[14])
        x, y, fw, fh = [float(v) for v in best[:4]]
        area = (fw * fh) / (w * h)
        # Big enough to read on a phone; very large (cropped) faces are fine too.
        size = min(1.0, area / 0.06)
        cx = (x + fw / 2) / w
        cy = (y + fh / 2) / h
        placement = 1.0 - min(1.0, abs(cy - 0.42) * 1.6) * 0.5 - min(1.0, abs(cx - 0.5)) * 0.3
        reye, leye, nose, rmouth, lmouth = [best[4 + 2 * i : 6 + 2 * i] for i in range(5)]
        eye_dist = max(1.0, float(np.linalg.norm(leye - reye)))
        mouth_w = float(np.linalg.norm(lmouth - rmouth))
        # Front-on: the nose sits between the eyes.
        frontal = 1.0 - min(1.0, abs(float(nose[0]) - float((leye[0] + reye[0]) / 2)) / (eye_dist * 0.6))
        # A wide smile or open mouth makes the mouth wide relative to the eyes.
        expression = float(np.clip((mouth_w / eye_dist - 0.85) / 0.35, 0.0, 1.0))
        face_score = 0.55 * size + 0.25 * max(0.0, placement) + 0.2 * frontal
        # Where the face is (fractions of the frame), so the designer can zoom in on it.
        face_box = {"x": round(x / w, 4), "y": round(y / h, 4), "w": round(fw / w, 4), "h": round(fh / h, 4)}
        x0, y0 = max(0, int(x)), max(0, int(y))
        crop = gray[y0 : int(y + fh), x0 : int(x + fw)]
        if crop.size > 400:
            region = crop
        reasons.append("clear face" if size > 0.6 else "face")
        if frontal > 0.7:
            reasons.append("looking at camera")
        if expression > 0.45:
            reasons.append("expressive")

    sharp = float(cv2.Laplacian(region, cv2.CV_64F).var())
    sharpness = float(np.clip(math.log10(sharp + 1) / 3.0, 0.0, 1.0))
    brightness = float(gray.mean()) / 255.0
    exposure = 1.0 - min(1.0, abs(brightness - 0.52) / 0.42)
    contrast = float(np.clip(gray.std() / 64.0, 0.0, 1.0))
    colour = float(np.clip(_colourfulness(img) / 90.0, 0.0, 1.0))

    if sharpness > 0.7:
        reasons.append("sharp")
    if exposure > 0.75:
        reasons.append("well lit")
    if colour > 0.55:
        reasons.append("colourful")

    if faces:
        total = 0.38 * face_score + 0.12 * expression + 0.2 * sharpness + 0.12 * exposure + 0.08 * contrast + 0.1 * colour
    else:
        total = 0.35 * sharpness + 0.25 * exposure + 0.2 * contrast + 0.2 * colour
    return {
        "score": round(total * 100, 1),
        "faces": len(faces),
        "face": face_box,
        "reasons": reasons,
        "parts": {
            "face": round(face_score, 3),
            "expression": round(expression, 3),
            "sharpness": round(sharpness, 3),
            "exposure": round(exposure, 3),
            "contrast": round(contrast, 3),
            "colour": round(colour, 3),
        },
    }


def pick_candidates(video_path: Path, out_dir: Path, prefix: str, start: float = 0.0, end: Optional[float] = None, count: int = 6, samples: int = 28) -> Dict[str, Any]:
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise ValueError("The video could not be opened.")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frames = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
    duration = frames / fps if frames else 0.0
    end = min(end if end and end > 0 else duration, duration or (end or 0))
    start = max(0.0, min(start, max(0.0, end - 0.5)))
    span = max(0.5, end - start)
    # Skip the very first and last moments (fades, black frames).
    times = [start + span * (0.04 + 0.92 * i / max(1, samples - 1)) for i in range(samples)]

    scored: List[Dict[str, Any]] = []
    for t in times:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000.0)
        ok, frame = cap.read()
        if not ok or frame is None:
            continue
        h, w = frame.shape[:2]
        small = cv2.resize(frame, (SCORE_WIDTH, max(1, int(h * SCORE_WIDTH / w)))) if w > SCORE_WIDTH else frame
        info = score_frame(small)
        info["time"] = round(t, 3)
        info["_frame"] = frame
        scored.append(info)
    cap.release()
    if not scored:
        raise ValueError("No frames could be read from the video.")

    # Best first, keeping picks apart in time so the options differ.
    min_gap = span / max(2, count) * 0.6
    picked: List[Dict[str, Any]] = []
    for item in sorted(scored, key=lambda s: s["score"], reverse=True):
        if all(abs(item["time"] - p["time"]) >= min_gap for p in picked):
            picked.append(item)
        if len(picked) >= count:
            break

    out_dir.mkdir(parents=True, exist_ok=True)
    results = []
    for i, item in enumerate(picked):
        path = out_dir / f"{prefix}-{i}.jpg"
        cv2.imwrite(str(path), item.pop("_frame"), [int(cv2.IMWRITE_JPEG_QUALITY), 92])
        item["path"] = str(path)
        results.append(item)
    for item in scored:
        item.pop("_frame", None)
    return {"candidates": results, "sampled": len(scored), "hasFaces": any(s["faces"] for s in scored), "duration": round(duration, 3)}
