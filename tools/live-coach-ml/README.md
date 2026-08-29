# Live Coach ML

The production champion-identity artifact must be trained from labeled crops taken from real
minimap ROI frames. Square Data Dragon portraits are permitted only for the non-release ONNX runtime
smoke artifact.

## Bootstrap runtime smoke artifact

Prepare square-portrait templates for the current patch, then export the non-release ONNX smoke
artifact explicitly:

```powershell
node scripts/prepare-live-coach-champion-templates.mjs --patch 16.17.1

python tools/live-coach-ml/export_bootstrap_identity_onnx.py `
  --source resources/live-coach/models/champion-icons-16-17-1.json `
  --output resources/live-coach/models/champion-identity-16-17-1-bootstrap.onnx `
  --manifest resources/live-coach/models/manifest.json
```

Template preparation never writes `manifest.json`. The exporter merges a schema-v2 runtime entry,
marks its dataset as `square-portrait-bootstrap`, and hard-locks `releaseEligible` to `false`.
Both bootstrap export and real-ROI training refuse to replace an existing accepted entry or any
model/report file referenced by one. An invalid or legacy runtime manifest also fails closed instead
of being silently replaced.

## Dataset contract

Keep the complete dataset outside this repository. Each line in `manifests/dataset-v1.jsonl` is a
JSON object with these required fields:

```json
{
  "schemaVersion": 1,
  "sourceKind": "real-minimap-roi",
  "sampleId": "<sha256 of image bytes>",
  "image": "roi/<sha256>.png",
  "championId": 103,
  "split": "train",
  "artifactId": "match-opaque-id",
  "patch": "16.17.1",
  "resolution": "1920x1080",
  "dpiScale": 1.0,
  "uiScale": 1.0,
  "minimapSide": "right",
  "captureBackend": "wgc",
  "windowMode": "borderless",
  "brightness": "normal",
  "authorization": {
    "category": "owner-recorded",
    "withdrawalId": "withdrawal-opaque-id"
  },
  "annotator": "annotator-opaque-id",
  "reviewer": "reviewer-opaque-id"
}
```

Use `championId: null` and `split: "unknown-test"` for hard negatives. One `artifactId` may not cross
train, validation, and test splits. `identity_dataset.py` verifies paths, hashes, authorization,
review metadata, split isolation, and per-class split coverage before training starts.

Before installing PyTorch or starting a long training run, execute the dependency-free audit:

```powershell
python tools/live-coach-ml/audit_identity_dataset.py `
  --dataset-root D:\live-coach-data `
  --manifest D:\live-coach-data\manifests\dataset-v1.jsonl `
  --patch 16.17.1 `
  --output D:\live-coach-data\reports\16.17.1-dataset-audit.json
```

The command exits with code `0` only when the manifest contract and every dataset release gate pass,
`1` when the dataset is invalid, and `2` when the dataset is valid but incomplete. Use
`--allow-incomplete` only for non-release inventory work.

Run the dependency-free dataset and runtime-manifest regression suites with:

```powershell
python -m unittest discover -s tools/live-coach-ml -p "test_*.py"
```

## Reproducible training and export

Create a Python 3.12 environment from `requirements-training.lock`, then run:

```powershell
python tools/live-coach-ml/train_identity.py `
  --dataset-root D:\live-coach-data `
  --manifest D:\live-coach-data\manifests\dataset-v1.jsonl `
  --output-root D:\live-coach-data\reports\16.17.1-mobilenetv3-small.1 `
  --patch 16.17.1 `
  --version 16.17.1-mobilenetv3-small.1
```

The command trains MobileNetV3 Small, exports opset-17 ONNX, evaluates the fixed test and unknown
sets, and writes a hash-locked validation report plus runtime manifest. `releaseEligible` stays false
even when the quality gates pass: a release owner must separately record the compatible worker
protocol and an approved, hash-locked model license notice in the runtime manifest before setting
`releaseEligible` to true. Copy only that reviewed ONNX file, report, license notice, and manifest
into `resources/live-coach/models/`.

Training stops before loading the model when the dataset gates are incomplete. The explicit
`--allow-incomplete-dataset` option permits exploratory training, but its output remains rejected and
must not be copied into the runtime model directory.

The dataset release gate is evaluated on independent splits, not on aggregate training coverage:

- every champion needs at least 10 train, 3 validation, and 5 test crops, with at least 20 labeled
  crops in total;
- labeled data needs at least 10 distinct matches and the test split at least 5 distinct matches;
- the unknown hard-negative split needs at least 500 crops from at least 10 distinct matches;
- test coverage must include 1920×1080 and 2560×1440, left/right minimaps, 100%/125%/150% DPI and
  UI scales, WGC/DDA capture, and windowed/borderless modes;
- unknown coverage must include both target resolutions, both minimap sides, and WGC/DDA;
- every sample must match the model patch, and annotator/reviewer identities must differ.
