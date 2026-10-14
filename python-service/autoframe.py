"""
Auto-framing: find the subject in each shot and plan a smooth crop path that keeps
it in frame when converting between aspect ratios (e.g. 16:9 -> 9:16).

Subject priority per sampled frame:
  1. Faces (OpenCV Haar cascade, bundled with opencv-python) - largest face, with a
     preference for the face nearest the previous subject so the crop doesn't hop.
  2. Motion centroid (frame difference) when no face is visible.
  3. Hold the previous position (or centre at the start of a shot).

The path is smoothed per shot and never across hard cuts, so a scene change jumps
straight to the new subject instead of panning across the cut.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

ANALYSIS_WIDTH = 480
SAMPLE_FPS = 6.0
CUT_THRESHOLD = 0.55          # HSV histogram correlation below this = hard cut
MOTION_MIN_AREA = 0.004       # fraction of pixels that must change to trust motion
DEAD_ZONE = 0.04              # fraction of crop width the subject may drift without the camera moving
MAX_PAN_PER_SEC = 0.9         # fraction of crop width the virtual camera may move per second
HEADROOM = 0.38               # subject centre sits this far down the crop when panning vertically

_face_cascade: Optional[cv2.CascadeClassifier] = None
_clahe_filter = None


def _faces() -> cv2.CascadeClassifier:
    global _face_cascade
    if _face_cascade is None:
        _face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    return _face_cascade


def _clahe():
    global _clahe_filter
    if _clahe_filter is None:
        _clahe_filter = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    return _clahe_filter


def parse_ratio(ratio: str) -> float:
    try:
        w, h = ratio.split(":")
        value = float(w) / float(h)
        if value <= 0:
            raise ValueError
        return value
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"Invalid aspect ratio: {ratio}") from exc


def even(value: float) -> int:
    return max(2, int(value) // 2 * 2)


@dataclass
class Sample:
    t: float
    cx: float  # subject centre, source pixels
    cy: float
    source: str  # "face" | "motion" | "hold"
    cut: bool


def _hist(frame_hsv: np.ndarray) -> np.ndarray:
    hist = cv2.calcHist([frame_hsv], [0, 1], None, [32, 32], [0, 180, 0, 256])
    return cv2.normalize(hist, hist).flatten()


def _detect_subject(
    small: np.ndarray,
    gray: np.ndarray,
    prev_gray: Optional[np.ndarray],
    prev_centre: Optional[Tuple[float, float]],
) -> Tuple[Optional[Tuple[float, float]], str]:
    h, w = gray.shape
    min_size = (max(24, w // 20), max(24, w // 20))
    faces = _faces().detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=min_size)
    if not len(faces):
        # Local contrast boost helps dark/backlit faces; global equalisation hurts flat scenes.
        faces = _faces().detectMultiScale(_clahe().apply(gray), scaleFactor=1.1, minNeighbors=5, minSize=min_size)
    if len(faces):
        def score(face) -> float:
            x, y, fw, fh = face
            area = fw * fh
            if prev_centre is None:
                return area
            dist = math.hypot(x + fw / 2 - prev_centre[0], y + fh / 2 - prev_centre[1]) / w
            return area * (1.0 - min(dist, 0.9))

        x, y, fw, fh = max(faces, key=score)
        # Aim slightly below the face so shoulders/body stay in frame.
        return (x + fw / 2, y + fh * 0.9), "face"

    if prev_gray is not None:
        diff = cv2.absdiff(gray, prev_gray)
        _, mask = cv2.threshold(cv2.GaussianBlur(diff, (5, 5), 0), 25, 255, cv2.THRESH_BINARY)
        moments = cv2.moments(mask, binaryImage=True)
        if moments["m00"] > MOTION_MIN_AREA * w * h:
            return (moments["m10"] / moments["m00"], moments["m01"] / moments["m00"]), "motion"

    return None, "hold"


def sample_subjects(video_path: str, sample_fps: float = SAMPLE_FPS) -> Tuple[List[Sample], Dict[str, float]]:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError("Could not open video for auto-framing")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if src_w <= 0 or src_h <= 0:
        cap.release()
        raise ValueError("Video has no readable frames")

    step = max(1, int(round(fps / sample_fps)))
    scale = ANALYSIS_WIDTH / src_w if src_w > ANALYSIS_WIDTH else 1.0

    samples: List[Sample] = []
    prev_gray = None
    prev_hist = None
    prev_centre_small: Optional[Tuple[float, float]] = None
    index = 0

    while True:
        ok = cap.grab()
        if not ok:
            break
        if index % step == 0:
            ok, frame = cap.retrieve()
            if not ok:
                break
            small = cv2.resize(frame, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale != 1.0 else frame
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            hist = _hist(cv2.cvtColor(small, cv2.COLOR_BGR2HSV))

            cut = prev_hist is not None and cv2.compareHist(prev_hist, hist, cv2.HISTCMP_CORREL) < CUT_THRESHOLD
            if cut:
                prev_gray = None
                prev_centre_small = None

            centre, source = _detect_subject(small, gray, prev_gray, prev_centre_small)
            if centre is not None:
                prev_centre_small = centre
            elif prev_centre_small is not None:
                centre = prev_centre_small
            else:
                centre = (small.shape[1] / 2, small.shape[0] / 2)

            samples.append(
                Sample(t=index / fps, cx=centre[0] / scale, cy=centre[1] / scale, source=source, cut=cut or not samples)
            )
            prev_gray = gray
            prev_hist = hist
        index += 1

    cap.release()
    duration = (frame_count or index) / fps
    return samples, {"fps": fps, "width": src_w, "height": src_h, "duration": duration}


def _smooth_shot(values: List[float], times: List[float], crop_extent: float, lo: float, hi: float) -> List[float]:
    """Dead-zone + zero-phase smoothing + speed limit for one shot along one axis."""
    if not values:
        return []
    arr = np.clip(np.array(values, dtype=float), lo, hi)

    # Median filter kills single-sample detection spikes.
    if len(arr) >= 5:
        padded = np.pad(arr, 2, mode="edge")
        arr = np.array([np.median(padded[i:i + 5]) for i in range(len(arr))])

    # Dead zone: only move the camera when the subject leaves a small window.
    held = [arr[0]]
    zone = DEAD_ZONE * crop_extent
    for v in arr[1:]:
        last = held[-1]
        held.append(last if abs(v - last) <= zone else v - math.copysign(zone, v - last))
    arr = np.array(held)

    # Forward + backward exponential smoothing = no lag.
    alpha = 0.35
    fwd = arr.copy()
    for i in range(1, len(fwd)):
        fwd[i] = alpha * arr[i] + (1 - alpha) * fwd[i - 1]
    bwd = fwd.copy()
    for i in range(len(bwd) - 2, -1, -1):
        bwd[i] = alpha * fwd[i] + (1 - alpha) * bwd[i + 1]

    # Limit pan speed so the virtual camera never whips.
    out = [bwd[0]]
    max_step_per_sec = MAX_PAN_PER_SEC * crop_extent
    for i in range(1, len(bwd)):
        dt = max(times[i] - times[i - 1], 1e-3)
        delta = np.clip(bwd[i] - out[-1], -max_step_per_sec * dt, max_step_per_sec * dt)
        out.append(out[-1] + delta)
    return [float(np.clip(v, lo, hi)) for v in out]


def plan_crop_path(video_path: str, target_ratio: str) -> Dict:
    ratio = parse_ratio(target_ratio)
    samples, meta = sample_subjects(video_path)
    src_w, src_h = meta["width"], meta["height"]
    src_ratio = src_w / src_h

    if abs(src_ratio - ratio) < 0.01:
        return {"noop": True, "reason": "Video already matches the target ratio", **meta, "cropWidth": src_w, "cropHeight": src_h, "keyframes": []}

    if src_ratio > ratio:
        crop_h = even(src_h)
        crop_w = even(min(src_w, src_h * ratio))
        axis = "x"
    else:
        crop_w = even(src_w)
        crop_h = even(min(src_h, src_w / ratio))
        axis = "y"

    # Split samples into shots at hard cuts, smooth each shot independently.
    shots: List[List[Sample]] = []
    for s in samples:
        if s.cut or not shots:
            shots.append([])
        shots[-1].append(s)

    keyframes = []
    for shot in shots:
        # Samples before the first detection in a shot only hold the frame centre;
        # start the shot on the subject instead of panning to it after the cut.
        first = next((s for s in shot if s.source != "hold"), None)
        if first is not None:
            for s in shot:
                if s.source != "hold":
                    break
                s.cx, s.cy = first.cx, first.cy
        times = [s.t for s in shot]
        if axis == "x":
            targets = [s.cx - crop_w / 2 for s in shot]
            positions = _smooth_shot(targets, times, crop_w, 0, src_w - crop_w)
            keyframes += [{"t": round(t, 3), "x": int(p) // 2 * 2, "y": 0, "cut": i == 0} for i, (t, p) in enumerate(zip(times, positions))]
        else:
            targets = [s.cy - crop_h * HEADROOM for s in shot]
            positions = _smooth_shot(targets, times, crop_h, 0, src_h - crop_h)
            keyframes += [{"t": round(t, 3), "x": 0, "y": int(p) // 2 * 2, "cut": i == 0} for i, (t, p) in enumerate(zip(times, positions))]

    face_share = sum(1 for s in samples if s.source == "face") / max(len(samples), 1)
    return {
        "noop": False,
        **meta,
        "cropWidth": crop_w,
        "cropHeight": crop_h,
        "axis": axis,
        "shots": len(shots),
        "faceCoverage": round(face_share, 3),
        "keyframes": keyframes,
    }
