"""Export the legacy template bank as an opset-17 ONNX runtime smoke model.

This artifact validates the Electron/ONNX Runtime/DML/CPU delivery path only.
It is deliberately marked releaseEligible=false because square source portraits
are not a substitute for the real, labeled minimap ROI dataset required by D08.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

from runtime_manifest import (
    assert_runtime_manifest_entry_writable,
    write_runtime_manifest_entry,
)


def normalize_nchw(values: list[int], size: int) -> np.ndarray:
    image = np.asarray(values, dtype=np.float32).reshape(size, size, 3)
    channels = np.transpose(image, (2, 0, 1))
    means = channels.mean(axis=(1, 2), keepdims=True)
    standard_deviations = channels.std(axis=(1, 2), keepdims=True)
    if np.any(standard_deviations < 1.0):
        raise ValueError("template has insufficient visual variance")
    normalized = (channels - means) / standard_deviations
    magnitude = np.linalg.norm(normalized)
    if not np.isfinite(magnitude) or magnitude < 1e-6:
        raise ValueError("template normalization failed")
    return (normalized / magnitude).reshape(-1)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    args = parser.parse_args()

    source = json.loads(args.source.read_text(encoding="utf-8"))
    if source.get("schemaVersion") != 1 or source.get("modelName") != "champion-icon-template-ncc":
        raise ValueError("source must be a champion-icon-template-ncc bootstrap artifact")
    if source.get("artifactKind", "square-portrait-bootstrap") != "square-portrait-bootstrap":
        raise ValueError("bootstrap source must be marked square-portrait-bootstrap")
    if source.get("releaseEligible", False) is not False:
        raise ValueError("square portrait bootstrap sources cannot be release-eligible")

    manifest_path = args.manifest.resolve()
    output_path = args.output.resolve()
    if output_path.parent != manifest_path.parent:
        raise ValueError("output and manifest must share one runtime model directory")
    assert_runtime_manifest_entry_writable(
        manifest_path, source["patch"], (output_path,)
    )
    input_size = int(source["inputSize"])
    champion_ids = sorted(int(value) for value in source["templates"].keys())
    crop_ratios = [float(value) for value in source["cropRatios"]]
    variants_per_champion = len(crop_ratios)

    columns: list[np.ndarray] = []
    for champion_id in champion_ids:
        variants = source["templates"][str(champion_id)]
        if len(variants) != variants_per_champion:
            raise ValueError(f"champion {champion_id} has inconsistent variant count")
        columns.extend(normalize_nchw(variant, input_size) for variant in variants)

    weights = np.stack(columns, axis=1).astype(np.float32)
    feature_count = 3 * input_size * input_size
    if weights.shape != (feature_count, len(champion_ids) * variants_per_champion):
        raise ValueError(f"unexpected weight shape: {weights.shape}")

    input_info = helper.make_tensor_value_info(
        "input", TensorProto.FLOAT, ["batch", 3, input_size, input_size]
    )
    output_info = helper.make_tensor_value_info(
        "template_scores",
        TensorProto.FLOAT,
        ["batch", len(champion_ids) * variants_per_champion],
    )
    graph = helper.make_graph(
        [
            helper.make_node("Flatten", ["input"], ["features"], axis=1),
            helper.make_node("MatMul", ["features", "weights"], ["template_scores"]),
        ],
        "league-akari-champion-identity-bootstrap",
        [input_info],
        [output_info],
        [numpy_helper.from_array(weights, name="weights")],
    )
    model = helper.make_model(
        graph,
        producer_name="league-akari-live-coach-ml",
        producer_version="1.0.0",
        opset_imports=[helper.make_opsetid("", 17)],
    )
    model.ir_version = 9
    onnx.checker.check_model(model, full_check=True)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    onnx.save_model(model, output_path)

    model_sha256 = sha256(output_path)
    runtime_entry = {
        "modelName": "champion-icon-onnx-bootstrap",
        "architecture": "bootstrap-linear",
        "format": "onnx",
        "version": f'{source["patch"]}-onnx-bootstrap.1',
        "sha256": model_sha256,
        "file": output_path.name,
        "workerProtocolVersion": "1.0.0",
        "license": {
            "status": "unreviewed",
            "identifier": None,
            "noticeFile": None,
            "noticeSha256": None,
        },
        "opset": 17,
        "inputName": "input",
        "outputName": "template_scores",
        "inputShape": [1, 3, input_size, input_size],
        "preprocessing": "per-channel-standardize-l2",
        "outputLayout": "prototype-scores",
        "cropRatios": crop_ratios,
        "championIds": champion_ids,
        "variantsPerChampion": variants_per_champion,
        "confidenceThreshold": 0.75,
        "top2MarginThreshold": 0.15,
        "dataset": {
            "kind": "square-portrait-bootstrap",
            "sha256": sha256(args.source),
            "sampleCount": len(champion_ids) * variants_per_champion,
        },
        "validation": {
            "status": "unvalidated",
            "reportSha256": None,
            "releaseEligible": False,
        },
    }
    write_runtime_manifest_entry(
        manifest_path,
        source["patch"],
        runtime_entry,
        (output_path,),
    )
    print(f"wrote {output_path} ({model_sha256})")
    print("releaseEligible=false: real labeled minimap ROI validation is still required")


if __name__ == "__main__":
    main()
