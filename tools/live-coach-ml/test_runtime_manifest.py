"""Tests for fail-closed runtime manifest updates."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from runtime_manifest import (
    assert_runtime_manifest_entry_writable,
    load_runtime_manifest,
    write_runtime_manifest_entry,
)


def entry(status: str, release_eligible: bool, file_name: str) -> dict:
    return {
        "file": file_name,
        "license": {"noticeFile": f"{file_name}.LICENSE.txt"},
        "validation": {
            "status": status,
            "reportFile": f"{file_name}.validation.json",
            "releaseEligible": release_eligible,
        },
    }


class RuntimeManifestTests(unittest.TestCase):
    def test_new_entry_uses_v2_and_preserves_other_patches(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manifest_path = Path(directory) / "manifest.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "schemaVersion": 2,
                        "models": {
                            "16.16.1": entry("unvalidated", False, "old-bootstrap.onnx")
                        },
                        "owner": "league-akari",
                    }
                ),
                encoding="utf-8",
            )

            write_runtime_manifest_entry(
                manifest_path,
                "16.17.1",
                entry("unvalidated", False, "new-bootstrap.onnx"),
            )

            manifest = load_runtime_manifest(manifest_path)
            self.assertEqual(manifest["schemaVersion"], 2)
            self.assertEqual(manifest["owner"], "league-akari")
            self.assertEqual(set(manifest["models"]), {"16.16.1", "16.17.1"})

    def test_accepted_patch_cannot_be_replaced_or_downgraded(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manifest_path = Path(directory) / "manifest.json"
            accepted = entry("accepted", True, "accepted.onnx")
            original = json.dumps(
                {"schemaVersion": 2, "models": {"16.17.1": accepted}}, indent=2
            )
            manifest_path.write_text(original, encoding="utf-8")

            with self.assertRaises(FileExistsError):
                write_runtime_manifest_entry(
                    manifest_path,
                    "16.17.1",
                    entry("unvalidated", False, "bootstrap.onnx"),
                )

            self.assertEqual(manifest_path.read_text(encoding="utf-8"), original)

    def test_accepted_artifact_path_cannot_be_overwritten_by_another_patch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manifest_path = Path(directory) / "manifest.json"
            model_path = Path(directory) / "accepted.onnx"
            license_path = Path(directory) / "accepted.onnx.LICENSE.txt"
            manifest_path.write_text(
                json.dumps(
                    {
                        "schemaVersion": 2,
                        "models": {"16.16.1": entry("accepted", True, model_path.name)},
                    }
                ),
                encoding="utf-8",
            )

            for protected_path in (model_path, license_path):
                with self.subTest(protected_path=protected_path.name):
                    with self.assertRaises(FileExistsError):
                        assert_runtime_manifest_entry_writable(
                            manifest_path, "16.17.1", (protected_path,)
                        )

    def test_unknown_manifest_schema_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manifest_path = Path(directory) / "manifest.json"
            original = '{"schemaVersion":1,"models":{}}'
            manifest_path.write_text(original, encoding="utf-8")

            with self.assertRaises(ValueError):
                write_runtime_manifest_entry(
                    manifest_path,
                    "16.17.1",
                    entry("unvalidated", False, "bootstrap.onnx"),
                )

            self.assertEqual(manifest_path.read_text(encoding="utf-8"), original)


if __name__ == "__main__":
    unittest.main()
