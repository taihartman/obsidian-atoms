#!/usr/bin/env python3
from __future__ import annotations

import argparse
from datetime import date
from pathlib import Path
import re
import subprocess


def slug(value: str) -> str:
  return re.sub(r'[^a-zA-Z0-9._-]+', '-', value.strip()).strip('-').lower() or 'qa'


def current_branch() -> str:
  try:
    return subprocess.check_output(['git', 'branch', '--show-current'], text=True).strip()
  except Exception:
    return 'unknown-branch'


def main() -> None:
  parser = argparse.ArgumentParser(description='Create a world-class QA report skeleton.')
  parser.add_argument('name', nargs='?', default=current_branch())
  args = parser.parse_args()

  report_dir = Path('docs/qa')
  report_dir.mkdir(parents=True, exist_ok=True)
  path = report_dir / f'{date.today().isoformat()}-{slug(args.name)}-world-class-qa.md'
  if path.exists():
    print(path)
    return

  path.write_text(
    f'''# World-Class QA: {args.name}

## Verdict

Ready / Ready after fixes / Not ready / Blocked

## Charter

What was tested and why.

## Preflight

- Run command:
- Fixture:
- Navigation map:
- Viewport/device:
- Auth path:
- Automation available:

## User Stories Tested

Concrete stories, acceptance criteria, evidence, and status.

## Risk Matrix

Positive, negative, edge, regression, perception, and accessibility checks.

## Evidence

Commands, screenshots, devices, CLI transcript, test data, and fixtures.

## Findings

Blocking and polish issues with evidence.

## Adversarial QA

Scenario ledger and proven holes from the destructive pass.

## Not Tested

Explicit gaps and residual risk.

## Merge Decision

Final recommendation.
''',
    encoding='utf-8',
  )
  print(path)


if __name__ == '__main__':
  main()
