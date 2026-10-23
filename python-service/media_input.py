"""Only trusted shared-volume files can enter the internal processing pipeline."""
from pathlib import Path
import shutil


def copy_media_input(source: str, destination: Path, shared_root: Path) -> Path:
    if not isinstance(source, str) or not source or '://' in source:
        raise ValueError('An uploaded local media file is required')
    root = shared_root.resolve(strict=True)
    original = Path(source).resolve(strict=True)
    target = destination.resolve()
    if not original.is_relative_to(root) or not target.is_relative_to(root):
        raise ValueError('Media path must stay inside the shared directory')
    if not original.is_file():
        raise ValueError('Media input must be a regular file')
    if original.stat().st_size > 2 * 1024 * 1024 * 1024:
        raise ValueError('Media input exceeds 2 GB')
    shutil.copy2(original, target)
    return target
