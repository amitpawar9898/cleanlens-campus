"""Train/validate/export a separate YOLO model; never replaces public/models/yolo11n.onnx."""
import argparse
import json
from pathlib import Path
from ultralytics import YOLO


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', required=True, help='Path to your dataset YAML')
    parser.add_argument('--model', default='yolo11n.pt', help='YOLO11 checkpoint or model name')
    parser.add_argument('--epochs', type=int, default=100)
    parser.add_argument('--imgsz', type=int, default=640)
    parser.add_argument('--device', default=None, help='For example 0, cpu, or mps')
    parser.add_argument('--project', default='runs/cleanlens')
    parser.add_argument('--name', default='food-detection')
    args = parser.parse_args()
    data = Path(args.data).expanduser().resolve()
    if not data.is_file():
        parser.error(f'Dataset YAML not found: {data}')

    model = YOLO(args.model)
    train_args = dict(data=str(data), epochs=args.epochs, imgsz=args.imgsz,
                      project=args.project, name=args.name, exist_ok=False)
    if args.device:
        train_args['device'] = args.device
    model.train(**train_args)

    best = Path(model.trainer.best).resolve()
    validator = YOLO(str(best))
    metrics = validator.val(data=str(data), imgsz=args.imgsz, split='test')
    report = {
        'checkpoint': str(best),
        'classes': validator.names,
        'precision': float(metrics.box.mp),
        'recall': float(metrics.box.mr),
        'map50': float(metrics.box.map50),
        'map50_95': float(metrics.box.map),
    }
    run_dir = Path(args.project) / args.name
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / 'validation.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    exported = validator.export(format='onnx', imgsz=args.imgsz, dynamic=False, simplify=True)
    (run_dir / 'classes.json').write_text(json.dumps(validator.names, indent=2), encoding='utf-8')
    print(json.dumps({**report, 'onnx': str(exported)}, indent=2))
    print('\nThe exported model is separate from the bundled model. Review held-out images and metrics before configuring it in Admin -> AI settings.')


if __name__ == '__main__':
    main()
