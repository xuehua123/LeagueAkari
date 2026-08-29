"""Dependency-free release gates for the champion identity dataset."""

from __future__ import annotations

from collections import Counter
from typing import Any

from identity_dataset import IdentityDataset, IdentitySample


def split_identity_samples(dataset: IdentityDataset) -> dict[str, list[IdentitySample]]:
    return {
        split: [sample for sample in dataset.samples if sample.split == split]
        for split in ["train", "validation", "test", "unknown-test"]
    }


def dataset_coverage(samples: list[IdentitySample]) -> dict[str, list[Any]]:
    return {
        "patches": sorted({sample.patch for sample in samples}),
        "resolutions": sorted({sample.resolution for sample in samples}),
        "dpiScales": sorted({sample.dpi_scale for sample in samples}),
        "uiScales": sorted({sample.ui_scale for sample in samples}),
        "minimapSides": sorted({sample.minimap_side for sample in samples}),
        "captureBackends": sorted({sample.capture_backend for sample in samples}),
        "windowModes": sorted({sample.window_mode for sample in samples}),
        "brightness": sorted({sample.brightness for sample in samples}),
    }


def minimum_class_count(samples: list[IdentitySample], champion_ids: list[int]) -> int:
    counts = Counter(sample.champion_id for sample in samples)
    return min((counts[champion_id] for champion_id in champion_ids), default=0)


def evaluate_dataset_gates(dataset: IdentityDataset, patch: str) -> dict[str, Any]:
    split_samples = split_identity_samples(dataset)
    champion_ids = list(dataset.champion_ids)
    labeled_samples = [sample for sample in dataset.samples if sample.champion_id is not None]
    test_coverage = dataset_coverage(split_samples["test"])
    unknown_coverage = dataset_coverage(split_samples["unknown-test"])
    required_resolutions = {"1920x1080", "2560x1440"}
    required_scales = {1.0, 1.25, 1.5}
    required_sides = {"left", "right"}
    required_backends = {"wgc", "dda"}
    required_window_modes = {"windowed", "borderless"}

    minimum_counts = {
        "labeled": minimum_class_count(labeled_samples, champion_ids),
        "train": minimum_class_count(split_samples["train"], champion_ids),
        "validation": minimum_class_count(split_samples["validation"], champion_ids),
        "test": minimum_class_count(split_samples["test"], champion_ids),
    }
    checks = {
        "labeledSamplesAtLeast20PerClass": minimum_counts["labeled"] >= 20,
        "trainSamplesAtLeast10PerClass": minimum_counts["train"] >= 10,
        "validationSamplesAtLeast3PerClass": minimum_counts["validation"] >= 3,
        "testSamplesAtLeast5PerClass": minimum_counts["test"] >= 5,
        "labeledMatchesAtLeast10": len({sample.artifact_id for sample in labeled_samples}) >= 10,
        "testMatchesAtLeast5": len(
            {sample.artifact_id for sample in split_samples["test"]}
        )
        >= 5,
        "unknownSamplesAtLeast500": len(split_samples["unknown-test"]) >= 500,
        "unknownMatchesAtLeast10": len(
            {sample.artifact_id for sample in split_samples["unknown-test"]}
        )
        >= 10,
        "patchIsExact": bool(dataset.samples)
        and all(sample.patch == patch for sample in dataset.samples),
        "testResolutionsCovered": required_resolutions.issubset(test_coverage["resolutions"]),
        "testDpiScalesCovered": required_scales.issubset(test_coverage["dpiScales"]),
        "testUiScalesCovered": required_scales.issubset(test_coverage["uiScales"]),
        "testMinimapSidesCovered": required_sides.issubset(test_coverage["minimapSides"]),
        "testCaptureBackendsCovered": required_backends.issubset(
            test_coverage["captureBackends"]
        ),
        "testWindowModesCovered": required_window_modes.issubset(test_coverage["windowModes"]),
        "unknownResolutionsCovered": required_resolutions.issubset(
            unknown_coverage["resolutions"]
        ),
        "unknownMinimapSidesCovered": required_sides.issubset(
            unknown_coverage["minimapSides"]
        ),
        "unknownCaptureBackendsCovered": required_backends.issubset(
            unknown_coverage["captureBackends"]
        ),
    }
    return {
        "passed": all(checks.values()),
        "checks": checks,
        "minimumSamplesPerClass": minimum_counts,
        "counts": {
            "classes": len(champion_ids),
            "labeledSamples": len(labeled_samples),
            "unknownSamples": len(split_samples["unknown-test"]),
            "labeledMatches": len({sample.artifact_id for sample in labeled_samples}),
            "testMatches": len({sample.artifact_id for sample in split_samples["test"]}),
            "unknownMatches": len(
                {sample.artifact_id for sample in split_samples["unknown-test"]}
            ),
        },
        "testCoverage": test_coverage,
        "unknownCoverage": unknown_coverage,
    }
