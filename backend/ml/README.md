# Train a CleanLens produce detector

The bundled `public/models/yolo11n.onnx` is the stock COCO model. It recognizes the COCO object classes (including apple, banana, orange, broccoli, and carrot) but it is not trained on mango, grapes, papaya, food spoilage, or campus waste. The app does not infer freshness from color. Gemini can provide a visual condition estimate when configured.

## Dataset needed

Collect and label images you have permission to use. Include each target class under varied lighting, clutter, distance, camera, and backgrounds; include spoiled and fresh examples for evaluating the separate condition estimate. Split by source/scene into `train`, `val`, and a held-out `test` set so near-identical images do not leak between sets. Use YOLO box annotations and keep the class order stable. Copy `dataset.example.yaml` to `dataset.yaml`, set its dataset root, and edit the class list to exactly match your labels.

## Train, evaluate, and export

From this directory:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item dataset.example.yaml dataset.yaml
# Edit dataset.yaml with the real dataset path and class list first.
python train_export.py --data dataset.yaml --epochs 100 --imgsz 640
```

The script reports precision, recall, mAP50 and mAP50-95 on the held-out test split, exports ONNX to a new run directory, and writes the class mapping. It never replaces the bundled model. Inspect the metrics, run the app's mixed/overlap/low-light/non-food examples, and only then set the ONNX model URL plus the class names in Admin -> AI settings. The browser expects a YOLO detection export with 640x640 input and a `[1, 4 + classes, N]` or `[1, N, 4 + classes]` output.

No labeled dataset is included, so model training and meaningful metric values cannot be produced by this repository alone.
