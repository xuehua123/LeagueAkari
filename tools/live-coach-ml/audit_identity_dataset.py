"""Audit a champion identity dataset without loading the ML training stack."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from identity_dataset import load_identity_dataset
from identity_gates import evaluate_dataset_gates


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate the identity dataset contract and Phase 1 release gates."
    )
    parser.add_argument("--dataset-root", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--patch", required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument(
        "--allow-incomplete",
        action="store_true",
        help="Return success even when the manifest is valid but release gates are incomplete.",
    )
    args = parser.parse_args()

    try:
        dataset = load_identity_dataset(args.dataset_root, args.manifest)
        gates = evaluate_dataset_gates(dataset, args.patch)
        report = {
            "schemaVersion": 1,
            "auditedAt": datetime.now(timezone.utc).isoformat(),
            "patch": args.patch,
            "dataset": {
                "sha256": dataset.sha256,
                "sampleCount": len(dataset.samples),
                "classCount": len(dataset.champion_ids),
            },
            "gates": gates,
        }
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(
            json.dumps(
                {"schemaVersion": 1, "valid": False, "error": str(error)},
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        return 1

    rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return 0 if gates["passed"] or args.allow_incomplete else 2


if __name__ == "__main__":
    raise SystemExit(main())
