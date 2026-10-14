"""
L1 optimal camera-path video stabilization.

Independent implementation of M. Grundmann, V. Kwatra, I. Essa, "Auto-Directed Video
Stabilization with Robust L1 Optimal Camera Paths", CVPR 2011. The same paper is
implemented by github.com/thejarlid/VideoStabilizationPy, which informed the approach;
no code is taken from it (that repository has no licence).

Pipeline
  1. Motion: track corners with pyramidal Lucas-Kanade between consecutive frames and fit
     a similarity transform (translation, rotation, scale) with RANSAC. Accumulating the
     per-frame motion gives the original camera path.
  2. Path: for each motion axis, solve the paper's L1 objective
         minimise  w1*|D1 p| + w2*|D2 p| + w3*|D3 p|
         subject to |p_t - c_t| <= r_t
     with a sparse linear program (HiGHS via scipy). L1 favours paths made of exactly
     static, constant-velocity and constant-acceleration pieces, like a camera operator.
     "Tripod" mode weights the first derivative so the camera holds still wherever the
     corridor allows. Axes are solved independently and in overlapping windows, so long
     videos stay fast and memory-bounded; scene cuts split the path.
  3. Render: warp each frame onto the smooth path, zoom to hide moving edges (or fill them
     with a blurred copy / black), and pipe frames to FFmpeg, keeping the original audio.
"""
from __future__ import annotations

import math
import subprocess
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Tuple

import cv2
import numpy as np
from scipy import sparse
from scipy.optimize import linprog

ANALYSIS_WIDTH = 640
WINDOW = 900          # frames per LP window
OVERLAP = 90          # frames shared between windows
CUT_MIN_INLIERS = 12  # fewer tracked inliers than this => treat as a scene cut

# Paper weights: first (static), second (constant velocity), third (constant acceleration) derivative.
WEIGHTS = {
    "smooth": (10.0, 1.0, 100.0),
    "tripod": (1000.0, 10.0, 100.0),
}

ProgressFn = Callable[[float], None]


@dataclass
class StabilizeOptions:
    mode: str = "smooth"          # "smooth" | "tripod"
    strength: float = 50.0        # 0..100
    zoom_mode: str = "auto"       # "auto" | "manual"
    zoom: float = 1.1             # used when zoom_mode == "manual"
    edge_fill: str = "zoom"       # "zoom" | "blur" | "black"
    correct_rotation: bool = True

    def normalised(self) -> "StabilizeOptions":
        return StabilizeOptions(
            mode=self.mode if self.mode in WEIGHTS else "smooth",
            strength=float(min(100.0, max(0.0, self.strength))),
            zoom_mode=self.zoom_mode if self.zoom_mode in ("auto", "manual") else "auto",
            zoom=float(min(1.5, max(1.0, self.zoom))),
            edge_fill=self.edge_fill if self.edge_fill in ("zoom", "blur", "black") else "zoom",
            correct_rotation=bool(self.correct_rotation),
        )


# ---------------------------------------------------------------------------
# 1. Motion estimation
# ---------------------------------------------------------------------------

def estimate_motion(video_path: str, progress: ProgressFn) -> Tuple[np.ndarray, List[int], Dict]:
    """Returns per-frame motion [dx, dy, da] (full-res pixels / radians), cut indices and metadata."""
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError("Could not open the video for stabilization")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1

    scale = ANALYSIS_WIDTH / width if width > ANALYSIS_WIDTH else 1.0
    ok, frame = cap.read()
    if not ok:
        cap.release()
        raise ValueError("The video has no readable frames")
    prev = cv2.cvtColor(cv2.resize(frame, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)

    motion = [(0.0, 0.0, 0.0)]
    cuts: List[int] = []
    index = 1
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        curr = cv2.cvtColor(cv2.resize(frame, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
        step = (0.0, 0.0, 0.0)
        pts = cv2.goodFeaturesToTrack(prev, maxCorners=300, qualityLevel=0.01, minDistance=15, blockSize=3)
        inliers = 0
        if pts is not None and len(pts) >= 8:
            nxt, status, _ = cv2.calcOpticalFlowPyrLK(prev, curr, pts, None, winSize=(21, 21), maxLevel=3)
            good_prev = pts[status.ravel() == 1]
            good_next = nxt[status.ravel() == 1]
            if len(good_prev) >= 8:
                m, mask = cv2.estimateAffinePartial2D(good_prev, good_next, method=cv2.RANSAC, ransacReprojThreshold=3.0)
                if m is not None:
                    inliers = int(mask.sum()) if mask is not None else 0
                    # The fit rotates about the top-left corner; re-express its translation about
                    # the image centre (t_c = t + (R - I) c), since corrections rotate about the centre.
                    cx, cy = curr.shape[1] / 2.0, curr.shape[0] / 2.0
                    tx = m[0, 2] + (m[0, 0] - 1) * cx + m[0, 1] * cy
                    ty = m[1, 2] + m[1, 0] * cx + (m[1, 1] - 1) * cy
                    step = (tx / scale, ty / scale, math.atan2(m[1, 0], m[0, 0]))
        if inliers < CUT_MIN_INLIERS:
            # Too little shared content: scene cut or a featureless frame. Do not smooth across it.
            cuts.append(index)
            step = (0.0, 0.0, 0.0)
        motion.append(step)
        prev = curr
        index += 1
        if index % 15 == 0:
            progress(min(1.0, index / total))
    cap.release()
    return np.array(motion, dtype=float), cuts, {"fps": fps, "width": width, "height": height, "frames": index}


# ---------------------------------------------------------------------------
# 2. L1 optimal path
# ---------------------------------------------------------------------------

def _difference(n: int, order: int) -> sparse.csr_matrix:
    base = sparse.eye(n, format="csr")
    for _ in range(order):
        base = base[1:] - base[:-1]
    return base


def solve_l1_path(c: np.ndarray, radius: np.ndarray, weights: Tuple[float, float, float],
                  fixed_head: Optional[np.ndarray] = None) -> np.ndarray:
    """L1-smooth path p close to c: minimise sum_k w_k |D_k p|, |p - c| <= radius."""
    n = len(c)
    if n < 4 or float(np.max(radius)) <= 1e-9:
        return c.copy()

    d = [_difference(n, k) for k in (1, 2, 3)]
    sizes = [m.shape[0] for m in d]
    total_slack = sum(sizes)
    # Variables: [p (n), e1, e2, e3]
    cost = np.concatenate([np.zeros(n)] + [np.full(s, w) for s, w in zip(sizes, weights)])

    rows = []
    offset = n
    for m, s in zip(d, sizes):
        e = sparse.hstack([sparse.csr_matrix((s, offset - n)), -sparse.eye(s), sparse.csr_matrix((s, total_slack - (offset - n) - s))])
        rows.append(sparse.hstack([m, e]))    #  D p - e <= 0
        rows.append(sparse.hstack([-m, e]))   # -D p - e <= 0
        offset += s
    a_ub = sparse.vstack(rows, format="csc")
    b_ub = np.zeros(a_ub.shape[0])

    bounds = [(c[i] - radius[i], c[i] + radius[i]) for i in range(n)] + [(0, None)] * total_slack
    if fixed_head is not None:
        for i, value in enumerate(fixed_head[: min(3, n)]):
            bounds[i] = (value, value)

    result = linprog(cost, A_ub=a_ub, b_ub=b_ub, bounds=bounds, method="highs")
    if result.status != 0 or result.x is None:
        # Infeasible or failed: fall back to the least aggressive valid path.
        return c.copy()
    return result.x[:n]


def smooth_axis(c: np.ndarray, radius: np.ndarray, weights, cuts: List[int]) -> np.ndarray:
    """Solves shot by shot (split at cuts) in overlapping windows."""
    out = c.copy()
    bounds = [0] + sorted(set(i for i in cuts if 0 < i < len(c))) + [len(c)]
    for start, end in zip(bounds[:-1], bounds[1:]):
        pos = start
        head = None
        while pos < end:
            stop = min(end, pos + WINDOW)
            seg = solve_l1_path(c[pos:stop], radius[pos:stop], weights, head)
            out[pos:stop] = seg
            if stop >= end:
                break
            # Next window re-solves the overlap, continuing smoothly from the settled part.
            nxt = stop - OVERLAP
            head = out[nxt:nxt + 3].copy()
            pos = nxt
    return out


# ---------------------------------------------------------------------------
# 3. Rendering
# ---------------------------------------------------------------------------

def _plan(opts: StabilizeOptions, width: int, height: int) -> Tuple[float, float, float, float]:
    """Returns (zoom, radius_x, radius_y, radius_angle) for the chosen options."""
    s = opts.strength / 100.0
    if opts.edge_fill == "zoom":
        zoom = 1.02 + 0.23 * s if opts.zoom_mode == "auto" else opts.zoom
        usable = 0.9 if opts.zoom_mode == "auto" else 0.25 + 0.7 * s
        margin = (1.0 - 1.0 / zoom) / 2.0 * usable  # fraction of the frame each side
    else:
        zoom = opts.zoom if opts.zoom_mode == "manual" else 1.0
        margin = 0.015 + 0.085 * s  # edges get filled, so the corridor is not tied to zoom

    # Reserve a share of the margin for rotation; a corner moves ~angle * half-diagonal.
    rot_share = 0.3 if opts.correct_rotation else 0.0
    radius_x = margin * width * (1 - rot_share)
    radius_y = margin * height * (1 - rot_share)
    half_diag = 0.5 * math.hypot(width, height)
    radius_a = (margin * min(width, height) * rot_share) / half_diag if opts.correct_rotation else 0.0
    return zoom, radius_x, radius_y, radius_a


def stabilize_video(input_path: str, output_path: str, options: StabilizeOptions,
                    progress: ProgressFn = lambda _f: None) -> Dict:
    opts = options.normalised()

    motion, cuts, meta = estimate_motion(input_path, lambda f: progress(0.35 * f))
    width, height, fps = meta["width"], meta["height"], meta["fps"]
    n = len(motion)

    # Camera path = accumulated motion, restarting at each cut.
    path = np.zeros_like(motion)
    for i in range(1, n):
        path[i] = motion[i] if i in cuts else path[i - 1] + motion[i]

    zoom, rx, ry, ra = _plan(opts, width, height)
    weights = WEIGHTS[opts.mode]
    smooth = np.zeros_like(path)
    smooth[:, 0] = smooth_axis(path[:, 0], np.full(n, rx), weights, cuts)
    progress(0.42)
    smooth[:, 1] = smooth_axis(path[:, 1], np.full(n, ry), weights, cuts)
    progress(0.48)
    smooth[:, 2] = smooth_axis(path[:, 2], np.full(n, ra), weights, cuts) if ra > 0 else path[:, 2]
    progress(0.5)

    correction = smooth - path
    centre = (width / 2.0, height / 2.0)

    ffmpeg = subprocess.Popen(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{width}x{height}", "-r", f"{fps:.6f}", "-i", "-",
            "-i", input_path,
            "-map", "0:v:0", "-map", "1:a:0?",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart",
            output_path,
        ],
        stdin=subprocess.PIPE, stderr=subprocess.PIPE,
    )

    cap = cv2.VideoCapture(input_path)
    full_mask = np.full((height, width), 255, np.uint8)
    border = cv2.BORDER_CONSTANT
    written = 0
    try:
        for i in range(n):
            ok, frame = cap.read()
            if not ok:
                break
            dx, dy, da = correction[i]
            # getRotationMatrix2D's positive angle is the opposite sense to atan2(m10, m00)
            # measured in estimate_motion, hence -da. Its matrix already includes the zoom.
            m = cv2.getRotationMatrix2D(centre, math.degrees(-da), zoom)
            m[:, 2] += m[:, :2] @ np.array([dx, dy])
            warped = cv2.warpAffine(frame, m, (width, height), flags=cv2.INTER_LINEAR, borderMode=border, borderValue=(0, 0, 0))
            if opts.edge_fill == "blur":
                mask = cv2.warpAffine(full_mask, m, (width, height), flags=cv2.INTER_NEAREST, borderMode=border, borderValue=0)
                if mask.min() == 0:
                    small = cv2.resize(frame, (max(2, width // 8), max(2, height // 8)), interpolation=cv2.INTER_AREA)
                    background = cv2.resize(cv2.GaussianBlur(small, (0, 0), 6), (width, height), interpolation=cv2.INTER_LINEAR)
                    warped = np.where(mask[..., None] > 0, warped, background)
            ffmpeg.stdin.write(warped.tobytes())
            written += 1
            if i % 15 == 0:
                progress(0.5 + 0.5 * i / max(n, 1))
    finally:
        cap.release()
        if ffmpeg.stdin:
            ffmpeg.stdin.close()
        _, err = ffmpeg.communicate()
    if ffmpeg.returncode != 0:
        raise RuntimeError(f"FFmpeg failed while writing the stabilized video: {err.decode(errors='ignore')[-400:]}")

    shake = np.abs(np.diff(path[:, :2], axis=0)).mean() if n > 1 else 0.0
    residual = np.abs(np.diff(smooth[:, :2], n=2, axis=0)).mean() if n > 2 else 0.0
    return {
        "frames": written,
        "fps": fps,
        "width": width,
        "height": height,
        "zoom": round(zoom, 3),
        "shots": len(cuts) + 1,
        "mode": opts.mode,
        "edgeFill": opts.edge_fill,
        "rotationCorrected": opts.correct_rotation,
        "maxCorrectionPx": round(float(np.abs(correction[:, :2]).max()) if n else 0.0, 1),
        "meanMotionPx": round(float(shake), 2),
        "pathAccelerationPx": round(float(residual), 3),
    }
