#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path


def main() -> None:
  parser = argparse.ArgumentParser(description='Add a border around a QA screenshot.')
  parser.add_argument('input')
  parser.add_argument('output', nargs='?')
  parser.add_argument('--border', type=int, default=4)
  args = parser.parse_args()

  try:
    from PIL import Image, ImageOps
  except ImportError as error:
    raise SystemExit('Pillow is required: python3 -m pip install Pillow') from error

  input_path = Path(args.input)
  output_path = (
    Path(args.output)
    if args.output
    else input_path.with_name(f'{input_path.stem}-bordered{input_path.suffix}')
  )
  image = Image.open(input_path)
  bordered = ImageOps.expand(image, border=args.border, fill='black')
  output_path.parent.mkdir(parents=True, exist_ok=True)
  bordered.save(output_path)
  print(output_path)


if __name__ == '__main__':
  main()
