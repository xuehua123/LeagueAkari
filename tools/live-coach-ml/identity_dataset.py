"""Validated real-minimap ROI dataset contract for champion identity training."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

Split = Literal["train", "validation", "test", "unknown-test"]


@dataclass(frozen=True)
class IdentitySample:
    sample_id: str
    image_path: Path
    champion_id: int | None
    split: Split
    artifact_id: str
    patch: str
    resolution: str
    dpi_scale: float
    ui_scale: float
    minimap_side: Literal["left", "right"]
    capture_backend: Literal["wgc", "dda", "desktopCapturer"]
    window_mode: Literal["windowed", "borderless", "exclusive-fullscreen"]
    brightness: Literal["dark", "normal", "bright"]


@dataclass(frozen=True)
class IdentityDataset:
    samples: tuple[IdentitySample, ...]
    sha256: str

    @property
    def champion_ids(self) -> tuple[int, ...]:
        return tuple(sorted({sample.champion_id for sample in self.samples if sample.champion_id}))


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _require_string(record: dict, key: str, line_number: int) -> str:
    value = record.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"line {line_number}: {key} must be a non-empty string")
    return value.strip()


def load_identity_dataset(dataset_root: Path, manifest_path: Path) -> IdentityDataset:
    dataset_root = dataset_root.resolve()
    manifest_path = manifest_path.resolve()
    samples: list[IdentitySample] = []
    canonical_records: list[str] = []
    artifact_splits: dict[str, set[str]] = {}
    seen_sample_ids: set[str] = set()

    for line_number, line in enumerate(manifest_path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as error:
            raise ValueError(f"line {line_number}: invalid JSON: {error}") from error
        if not isinstance(record, dict) or record.get("schemaVersion") != 1:
            raise ValueError(f"line {line_number}: schemaVersion must be 1")
        if record.get("sourceKind") != "real-minimap-roi":
            raise ValueError(f"line {line_number}: sourceKind must be real-minimap-roi")

        sample_id = _require_string(record, "sampleId", line_number).lower()
        if len(sample_id) != 64 or any(character not in "0123456789abcdef" for character in sample_id):
            raise ValueError(f"line {line_number}: sampleId must be a lowercase SHA-256")
        if sample_id in seen_sample_ids:
            raise ValueError(f"line {line_number}: duplicate sampleId {sample_id}")
        seen_sample_ids.add(sample_id)

        relative_image = Path(_require_string(record, "image", line_number))
        if relative_image.is_absolute():
            raise ValueError(f"line {line_number}: image must be relative to the dataset root")
        image_path = (dataset_root / relative_image).resolve()
        if not image_path.is_relative_to(dataset_root) or not image_path.is_file():
            raise ValueError(f"line {line_number}: image escapes the dataset root or is missing")
        if _sha256_file(image_path) != sample_id:
            raise ValueError(f"line {line_number}: image bytes do not match sampleId")

        split = _require_string(record, "split", line_number)
        if split not in {"train", "validation", "test", "unknown-test"}:
            raise ValueError(f"line {line_number}: unsupported split {split}")
        champion_id = record.get("championId")
        if split == "unknown-test":
            if champion_id is not None:
                raise ValueError(f"line {line_number}: unknown-test must use championId=null")
        elif not isinstance(champion_id, int) or isinstance(champion_id, bool) or champion_id <= 0:
            raise ValueError(f"line {line_number}: labeled splits require a positive championId")

        artifact_id = _require_string(record, "artifactId", line_number)
        artifact_splits.setdefault(artifact_id, set()).add(split)
        authorization = record.get("authorization")
        if not isinstance(authorization, dict):
            raise ValueError(f"line {line_number}: authorization is required")
        if authorization.get("category") not in {"owner-recorded", "explicit-opt-in"}:
            raise ValueError(f"line {line_number}: dataset sample lacks an allowed authorization")
        _require_string(authorization, "withdrawalId", line_number)
        annotator = _require_string(record, "annotator", line_number)
        reviewer = _require_string(record, "reviewer", line_number)
        if annotator == reviewer:
            raise ValueError(f"line {line_number}: annotator and reviewer must be different")

        resolution = _require_string(record, "resolution", line_number)
        if re.fullmatch(r"[1-9]\d{2,4}x[1-9]\d{2,4}", resolution) is None:
            raise ValueError(f"line {line_number}: resolution must use WIDTHxHEIGHT")
        minimap_side = _require_string(record, "minimapSide", line_number)
        capture_backend = _require_string(record, "captureBackend", line_number)
        window_mode = _require_string(record, "windowMode", line_number)
        brightness = _require_string(record, "brightness", line_number)
        if minimap_side not in {"left", "right"}:
            raise ValueError(f"line {line_number}: invalid minimapSide")
        if capture_backend not in {"wgc", "dda", "desktopCapturer"}:
            raise ValueError(f"line {line_number}: invalid captureBackend")
        if window_mode not in {"windowed", "borderless", "exclusive-fullscreen"}:
            raise ValueError(f"line {line_number}: invalid windowMode")
        if brightness not in {"dark", "normal", "bright"}:
            raise ValueError(f"line {line_number}: invalid brightness")

        dpi_scale = record.get("dpiScale")
        ui_scale = record.get("uiScale")
        if not isinstance(dpi_scale, (int, float)) or isinstance(dpi_scale, bool) or dpi_scale <= 0:
            raise ValueError(f"line {line_number}: dpiScale must be positive")
        if not isinstance(ui_scale, (int, float)) or isinstance(ui_scale, bool) or ui_scale <= 0:
            raise ValueError(f"line {line_number}: uiScale must be positive")

        samples.append(
            IdentitySample(
                sample_id=sample_id,
                image_path=image_path,
                champion_id=champion_id,
                split=split,  # type: ignore[arg-type]
                artifact_id=artifact_id,
                patch=_require_string(record, "patch", line_number),
                resolution=resolution,
                dpi_scale=float(dpi_scale),
                ui_scale=float(ui_scale),
                minimap_side=minimap_side,  # type: ignore[arg-type]
                capture_backend=capture_backend,  # type: ignore[arg-type]
                window_mode=window_mode,  # type: ignore[arg-type]
                brightness=brightness,  # type: ignore[arg-type]
            )
        )
        canonical_records.append(json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":")))

    if not samples:
        raise ValueError("dataset manifest is empty")
    for artifact_id, splits in artifact_splits.items():
        labeled_splits = splits & {"train", "validation", "test"}
        if len(labeled_splits) > 1:
            raise ValueError(f"artifact {artifact_id} leaks across labeled splits: {sorted(labeled_splits)}")

    champion_ids = {sample.champion_id for sample in samples if sample.champion_id is not None}
    for champion_id in champion_ids:
        present_splits = {sample.split for sample in samples if sample.champion_id == champion_id}
        if not {"train", "validation", "test"}.issubset(present_splits):
            raise ValueError(f"champion {champion_id} is not represented in train/validation/test")

    digest = hashlib.sha256()
    for canonical_record in sorted(canonical_records):
        digest.update(canonical_record.encode("utf-8"))
        digest.update(b"\n")
    return IdentityDataset(tuple(samples), digest.hexdigest())
