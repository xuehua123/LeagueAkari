"""Train, evaluate, export, and gate the MobileNetV3 Small champion identity model."""

from __future__ import annotations

import argparse
import hashlib
import json
import random
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import onnx
import torch
from PIL import Image
from torch import nn
from torch.utils.data import DataLoader, Dataset
from torchvision import models, transforms

from identity_dataset import IdentitySample, load_identity_dataset
from identity_gates import evaluate_dataset_gates, split_identity_samples
from runtime_manifest import (
    assert_runtime_manifest_entry_writable,
    write_runtime_manifest_entry,
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class ChampionDataset(Dataset):
    def __init__(self, samples: list[IdentitySample], class_index: dict[int, int], transform):
        self.samples = samples
        self.class_index = class_index
        self.transform = transform

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, index: int):
        sample = self.samples[index]
        if sample.champion_id is None:
            raise ValueError("unknown-test samples cannot enter a labeled DataLoader")
        with Image.open(sample.image_path) as image:
            tensor = self.transform(image.convert("RGB"))
        return tensor, self.class_index[sample.champion_id]


def create_transforms(input_size: int):
    normalize = transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
    training = transforms.Compose(
        [
            transforms.Resize((input_size + 8, input_size + 8)),
            transforms.RandomResizedCrop(input_size, scale=(0.78, 1.0), ratio=(0.9, 1.1)),
            transforms.RandomAffine(degrees=5, translate=(0.04, 0.04), scale=(0.92, 1.08)),
            transforms.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.12),
            transforms.ToTensor(),
            normalize,
        ]
    )
    evaluation = transforms.Compose(
        [transforms.Resize((input_size, input_size)), transforms.ToTensor(), normalize]
    )
    return training, evaluation


def build_model(class_count: int) -> nn.Module:
    model = models.mobilenet_v3_small(weights=None)
    final_layer = model.classifier[-1]
    if not isinstance(final_layer, nn.Linear):
        raise RuntimeError("torchvision MobileNetV3 Small classifier contract changed")
    model.classifier[-1] = nn.Linear(final_layer.in_features, class_count)
    return model


def evaluate_labeled(model: nn.Module, loader: DataLoader, device: torch.device):
    predictions: list[int] = []
    targets: list[int] = []
    model.eval()
    with torch.inference_mode():
        for inputs, labels in loader:
            logits = model(inputs.to(device))
            predictions.extend(logits.argmax(dim=1).cpu().tolist())
            targets.extend(labels.tolist())
    if not targets:
        raise ValueError("test split is empty")
    class_count = len(set(targets))
    recalls: list[float] = []
    f1_scores: list[float] = []
    for class_index in range(class_count):
        true_positive = sum(p == class_index and t == class_index for p, t in zip(predictions, targets))
        false_positive = sum(p == class_index and t != class_index for p, t in zip(predictions, targets))
        false_negative = sum(p != class_index and t == class_index for p, t in zip(predictions, targets))
        precision = true_positive / max(1, true_positive + false_positive)
        recall = true_positive / max(1, true_positive + false_negative)
        recalls.append(recall)
        f1_scores.append(2 * precision * recall / max(1e-12, precision + recall))
    return {
        "top1Accuracy": sum(p == t for p, t in zip(predictions, targets)) / len(targets),
        "macroF1": sum(f1_scores) / len(f1_scores),
        "minimumClassRecall": min(recalls),
    }


def evaluate_unknown_false_accept_rate(
    model: nn.Module,
    samples: list[IdentitySample],
    transform,
    device: torch.device,
    confidence_threshold: float,
    margin_threshold: float,
) -> float:
    if not samples:
        return 1.0
    accepted = 0
    model.eval()
    with torch.inference_mode():
        for sample in samples:
            with Image.open(sample.image_path) as image:
                inputs = transform(image.convert("RGB")).unsqueeze(0).to(device)
            probabilities = model(inputs).softmax(dim=1)[0]
            top = torch.topk(probabilities, min(2, probabilities.numel())).values
            margin = float(top[0] - top[1]) if top.numel() > 1 else float(top[0])
            if float(top[0]) >= confidence_threshold and margin >= margin_threshold:
                accepted += 1
    return accepted / len(samples)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-root", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--output-root", required=True, type=Path)
    parser.add_argument("--patch", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--input-size", type=int, default=64)
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument("--seed", type=int, default=20260827)
    parser.add_argument("--confidence-threshold", type=float, default=0.75)
    parser.add_argument("--margin-threshold", type=float, default=0.15)
    parser.add_argument(
        "--allow-incomplete-dataset",
        action="store_true",
        help="Allow exploratory training while keeping the generated artifact release-ineligible.",
    )
    args = parser.parse_args()

    manifest_path = args.output_root / "manifest.json"
    model_path = args.output_root / f"champion-identity-{args.patch.replace('.', '-')}.onnx"
    report_path = (
        args.output_root
        / f"champion-identity-{args.patch.replace('.', '-')}-validation.json"
    )
    assert_runtime_manifest_entry_writable(
        manifest_path, args.patch, (model_path, report_path)
    )

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed)
    torch.use_deterministic_algorithms(True)

    dataset = load_identity_dataset(args.dataset_root, args.manifest)
    champion_ids = list(dataset.champion_ids)
    class_index = {champion_id: index for index, champion_id in enumerate(champion_ids)}
    training_transform, evaluation_transform = create_transforms(args.input_size)
    split_samples = split_identity_samples(dataset)
    dataset_gates = evaluate_dataset_gates(dataset, args.patch)
    if not dataset_gates["passed"] and not args.allow_incomplete_dataset:
        failed_checks = [name for name, passed in dataset_gates["checks"].items() if not passed]
        raise ValueError(
            "dataset release gates failed before training: " + ", ".join(failed_checks)
        )

    loaders = {
        "train": DataLoader(
            ChampionDataset(split_samples["train"], class_index, training_transform),
            batch_size=args.batch_size,
            shuffle=True,
            num_workers=0,
        ),
        "validation": DataLoader(
            ChampionDataset(split_samples["validation"], class_index, evaluation_transform),
            batch_size=args.batch_size,
            shuffle=False,
            num_workers=0,
        ),
        "test": DataLoader(
            ChampionDataset(split_samples["test"], class_index, evaluation_transform),
            batch_size=args.batch_size,
            shuffle=False,
            num_workers=0,
        ),
    }
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = build_model(len(champion_ids)).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=1e-4)
    criterion = nn.CrossEntropyLoss(label_smoothing=0.05)
    best_validation_accuracy = -1.0
    best_state: dict[str, torch.Tensor] | None = None

    for epoch in range(args.epochs):
        model.train()
        for inputs, labels in loaders["train"]:
            optimizer.zero_grad(set_to_none=True)
            loss = criterion(model(inputs.to(device)), labels.to(device))
            loss.backward()
            optimizer.step()
        validation = evaluate_labeled(model, loaders["validation"], device)
        if validation["top1Accuracy"] > best_validation_accuracy:
            best_validation_accuracy = validation["top1Accuracy"]
            best_state = {key: value.detach().cpu().clone() for key, value in model.state_dict().items()}
        print(f"epoch={epoch + 1} validation_top1={validation['top1Accuracy']:.6f}")

    if best_state is None:
        raise RuntimeError("training did not produce a checkpoint")
    model.load_state_dict(best_state)
    model.to(device)
    metrics = evaluate_labeled(model, loaders["test"], device)
    metrics["unknownFalseAcceptRate"] = evaluate_unknown_false_accept_rate(
        model,
        split_samples["unknown-test"],
        evaluation_transform,
        device,
        args.confidence_threshold,
        args.margin_threshold,
    )

    args.output_root.mkdir(parents=True, exist_ok=True)
    model.cpu().eval()
    torch.onnx.export(
        model,
        torch.zeros(1, 3, args.input_size, args.input_size),
        model_path,
        input_names=["input"],
        output_names=["logits"],
        dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=17,
        dynamo=False,
    )
    onnx.checker.check_model(onnx.load(model_path), full_check=True)
    model_sha256 = sha256_file(model_path)
    labeled_samples = [sample for sample in dataset.samples if sample.champion_id is not None]
    accepted = (
        dataset_gates["passed"]
        and metrics["top1Accuracy"] >= 0.95
        and metrics["macroF1"] >= 0.93
        and metrics["minimumClassRecall"] >= 0.8
        and metrics["unknownFalseAcceptRate"] <= 0.01
    )
    report = {
        "schemaVersion": 1,
        "decision": "accepted" if accepted else "rejected",
        "evaluatedAt": datetime.now(timezone.utc).isoformat(),
        "model": {
            "modelName": "champion-icon-mobilenetv3-small",
            "version": args.version,
            "sha256": model_sha256,
        },
        "dataset": {
            "kind": "real-minimap-roi",
            "sha256": dataset.sha256,
            "sampleCount": len(labeled_samples),
            "distinctMatches": len({sample.artifact_id for sample in dataset.samples}),
            "classCount": len(champion_ids),
        },
        "metrics": metrics,
        # Runtime release validation consumes this compact, hash-locked coverage contract.
        # Keep it aligned with champion-identity-model.ts instead of relying on the more detailed
        # datasetGates diagnostic object below.
        "coverage": {
            "patches": dataset_gates["testCoverage"]["patches"],
            "resolutions": dataset_gates["testCoverage"]["resolutions"],
            "minimapSides": dataset_gates["testCoverage"]["minimapSides"],
            "uiScales": dataset_gates["testCoverage"]["uiScales"],
        },
        "datasetGates": dataset_gates,
        "training": {
            "architecture": "mobilenet-v3-small",
            "seed": args.seed,
            "epochs": args.epochs,
            "inputSize": args.input_size,
            "torchVersion": torch.__version__,
        },
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    report_sha256 = sha256_file(report_path)
    runtime_entry = {
        "modelName": "champion-icon-mobilenetv3-small",
        "architecture": "mobilenet-v3-small",
        "format": "onnx",
        "version": args.version,
        "sha256": model_sha256,
        "file": model_path.name,
        "workerProtocolVersion": "1.0.0",
        "license": {
            "status": "unreviewed",
            "identifier": None,
            "noticeFile": None,
            "noticeSha256": None,
        },
        "opset": 17,
        "inputName": "input",
        "outputName": "logits",
        "inputShape": [1, 3, args.input_size, args.input_size],
        "preprocessing": "imagenet",
        "outputLayout": "champion-logits",
        "cropRatios": [0.0, 0.08, 0.14],
        "championIds": champion_ids,
        "variantsPerChampion": 1,
        "confidenceThreshold": args.confidence_threshold,
        "top2MarginThreshold": args.margin_threshold,
        "dataset": {
            "kind": "real-minimap-roi",
            "sha256": dataset.sha256,
            "sampleCount": len(labeled_samples),
        },
        "validation": {
            "status": "accepted" if accepted else "rejected",
            "reportFile": report_path.name,
            "reportSha256": report_sha256,
            # Human license review is deliberately separate from model-quality validation.
            # A release owner must add a hash-locked approved license notice before enabling this.
            "releaseEligible": False,
        },
    }
    write_runtime_manifest_entry(
        manifest_path,
        args.patch,
        runtime_entry,
        (model_path, report_path),
    )
    print(json.dumps({"accepted": accepted, "model": str(model_path), "report": str(report_path)}))


if __name__ == "__main__":
    main()
