"""Tests for the dependency-free champion identity dataset release gates."""

from __future__ import annotations

import unittest
from pathlib import Path

from identity_dataset import IdentityDataset, IdentitySample
from identity_gates import evaluate_dataset_gates


def sample(
    index: int,
    *,
    champion_id: int | None,
    split: str,
    artifact_id: str,
    resolution: str = "1920x1080",
    scale: float = 1.0,
    side: str = "right",
    backend: str = "wgc",
    window_mode: str = "borderless",
) -> IdentitySample:
    return IdentitySample(
        sample_id=f"{index:064x}",
        image_path=Path(f"sample-{index}.png"),
        champion_id=champion_id,
        split=split,  # type: ignore[arg-type]
        artifact_id=artifact_id,
        patch="16.16.1",
        resolution=resolution,
        dpi_scale=scale,
        ui_scale=scale,
        minimap_side=side,  # type: ignore[arg-type]
        capture_backend=backend,  # type: ignore[arg-type]
        window_mode=window_mode,  # type: ignore[arg-type]
        brightness="normal",
    )


def passing_dataset() -> IdentityDataset:
    samples: list[IdentitySample] = []
    index = 1
    coverage = [
        ("1920x1080", 1.0, "left", "wgc", "windowed"),
        ("2560x1440", 1.25, "right", "dda", "borderless"),
        ("1920x1080", 1.5, "left", "wgc", "windowed"),
    ]
    for champion_id in [1, 2]:
        for split, count in [("train", 12), ("validation", 3), ("test", 5)]:
            for split_index in range(count):
                resolution, scale, side, backend, window_mode = coverage[split_index % 3]
                samples.append(
                    sample(
                        index,
                        champion_id=champion_id,
                        split=split,
                        artifact_id=f"labeled-{champion_id}-{split}-{split_index}",
                        resolution=resolution,
                        scale=scale,
                        side=side,
                        backend=backend,
                        window_mode=window_mode,
                    )
                )
                index += 1
    for unknown_index in range(500):
        resolution, scale, side, backend, window_mode = coverage[unknown_index % 3]
        samples.append(
            sample(
                index,
                champion_id=None,
                split="unknown-test",
                artifact_id=f"unknown-{unknown_index % 10}",
                resolution=resolution,
                scale=scale,
                side=side,
                backend=backend,
                window_mode=window_mode,
            )
        )
        index += 1
    return IdentityDataset(tuple(samples), "a" * 64)


class IdentityDatasetGateTests(unittest.TestCase):
    def test_complete_dataset_passes_every_gate(self) -> None:
        report = evaluate_dataset_gates(passing_dataset(), "16.16.1")

        self.assertTrue(report["passed"])
        self.assertTrue(all(report["checks"].values()))
        self.assertEqual(report["minimumSamplesPerClass"]["labeled"], 20)
        self.assertEqual(report["counts"]["unknownSamples"], 500)

    def test_aggregate_volume_cannot_hide_an_underrepresented_class(self) -> None:
        dataset = passing_dataset()
        samples = list(dataset.samples)
        samples.pop(0)

        report = evaluate_dataset_gates(IdentityDataset(tuple(samples), dataset.sha256), "16.16.1")

        self.assertFalse(report["checks"]["labeledSamplesAtLeast20PerClass"])
        self.assertEqual(report["minimumSamplesPerClass"]["labeled"], 19)
        self.assertFalse(report["passed"])

    def test_patch_mismatch_is_release_blocking(self) -> None:
        report = evaluate_dataset_gates(passing_dataset(), "16.17.1")

        self.assertFalse(report["checks"]["patchIsExact"])
        self.assertFalse(report["passed"])


if __name__ == "__main__":
    unittest.main()
