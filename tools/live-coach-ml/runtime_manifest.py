"""Fail-closed helpers for updating the champion identity runtime manifest."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

RUNTIME_MANIFEST_SCHEMA_VERSION = 2


def load_runtime_manifest(manifest_path: Path) -> dict[str, Any]:
    """Load a v2 manifest without silently replacing an unknown contract."""

    if not manifest_path.exists():
        return {"schemaVersion": RUNTIME_MANIFEST_SCHEMA_VERSION, "models": {}}
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"cannot safely read runtime manifest {manifest_path}: {error}") from error
    if not isinstance(manifest, dict):
        raise ValueError("runtime manifest must be a JSON object")
    if manifest.get("schemaVersion") != RUNTIME_MANIFEST_SCHEMA_VERSION:
        raise ValueError(
            f"runtime manifest schemaVersion must be {RUNTIME_MANIFEST_SCHEMA_VERSION}"
        )
    if not isinstance(manifest.get("models"), dict):
        raise ValueError("runtime manifest models must be an object")
    return manifest


def _is_protected_entry(entry: object) -> bool:
    if not isinstance(entry, dict):
        return False
    validation = entry.get("validation")
    return isinstance(validation, dict) and (
        validation.get("status") == "accepted"
        or validation.get("releaseEligible") is True
    )


def assert_runtime_manifest_entry_writable(
    manifest_path: Path,
    patch: str,
    artifact_paths: tuple[Path, ...] = (),
) -> dict[str, Any]:
    """Refuse to downgrade accepted entries or overwrite their hash-locked files."""

    if not patch.strip():
        raise ValueError("patch must be a non-empty string")
    manifest = load_runtime_manifest(manifest_path)
    models = manifest["models"]
    existing = models.get(patch)
    if _is_protected_entry(existing):
        raise FileExistsError(
            f"refusing to replace accepted runtime model entry for patch {patch}"
        )

    protected_paths: set[Path] = set()
    for entry in models.values():
        if not _is_protected_entry(entry):
            continue
        assert isinstance(entry, dict)
        validation = entry.get("validation")
        license_metadata = entry.get("license")
        for file_name in (
            entry.get("file"),
            validation.get("reportFile") if isinstance(validation, dict) else None,
            (
                license_metadata.get("noticeFile")
                if isinstance(license_metadata, dict)
                else None
            ),
        ):
            if isinstance(file_name, str) and file_name == Path(file_name).name:
                protected_paths.add((manifest_path.parent / file_name).resolve())

    collisions = [
        path.resolve() for path in artifact_paths if path.resolve() in protected_paths
    ]
    if collisions:
        raise FileExistsError(
            "refusing to overwrite an artifact referenced by an accepted runtime model: "
            + ", ".join(str(path) for path in collisions)
        )
    return manifest


def write_runtime_manifest_entry(
    manifest_path: Path,
    patch: str,
    entry: dict[str, Any],
    artifact_paths: tuple[Path, ...] = (),
) -> None:
    """Atomically merge one entry while preserving other patch registrations."""

    manifest = assert_runtime_manifest_entry_writable(
        manifest_path, patch, artifact_paths
    )
    models = dict(manifest["models"])
    models[patch] = entry
    next_manifest = {**manifest, "schemaVersion": 2, "models": models}

    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{manifest_path.name}.", suffix=".tmp", dir=manifest_path.parent
    )
    try:
        with os.fdopen(file_descriptor, "w", encoding="utf-8", newline="\n") as file:
            json.dump(next_manifest, file, ensure_ascii=False, indent=2)
            file.write("\n")
            file.flush()
            os.fsync(file.fileno())
        Path(temporary_name).replace(manifest_path)
    except BaseException:
        Path(temporary_name).unlink(missing_ok=True)
        raise
