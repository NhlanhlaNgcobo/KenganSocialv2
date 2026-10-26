"""
Downloads model files too large to keep in git, pinned to a revision and checked by SHA-256.

    python scripts/download_models.py

The Dockerfile runs this at build time. Existing files with the right checksum are left alone.
"""
import hashlib
import sys
import urllib.request
from pathlib import Path

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"

MODELS = [
    {
        # MODNet portrait matting (Apache-2.0), ONNX build from huggingface.co/Xenova/modnet.
        "file": "modnet.onnx",
        "url": "https://huggingface.co/Xenova/modnet/resolve/fa2fa546052fba4c08921230a26cc69a333fca12/onnx/model.onnx",
        "sha256": "07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9",
    },
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    MODELS_DIR.mkdir(exist_ok=True)
    for model in MODELS:
        target = MODELS_DIR / model["file"]
        if target.is_file() and sha256(target) == model["sha256"]:
            print(f"{model['file']}: present")
            continue
        print(f"{model['file']}: downloading")
        partial = target.with_suffix(".part")
        urllib.request.urlretrieve(model["url"], partial)
        if sha256(partial) != model["sha256"]:
            partial.unlink(missing_ok=True)
            print(f"{model['file']}: checksum mismatch, not installed", file=sys.stderr)
            return 1
        partial.replace(target)
        print(f"{model['file']}: installed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
