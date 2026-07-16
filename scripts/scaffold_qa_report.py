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
    f'''# World-Class QA: {args.name}\n\n'''
    '''## Verdict\n\nReady / Ready after fixes / Not ready / Blocked\n\n'''
    '''## Charter\n\nWhat was tested and why.\n\n'''
    '''## Preflight\n\n- Run command:\n- Fixture:\n- Navigation map:\n- Viewport/device:\n- Auth path:\n- Automation available:\n\n'''
    '''## User Stories Tested\n\nConcrete stories, acceptance criteria, evidence, and status.\n\n'''
    '''## Risk Matrix\n\nPositive, negative, edge, regression, perception, and accessibility checks.\n\n'''
    '''## Evidence\n\nCommands, screenshots, devices, browser paths, test data, and fixtures.\n\n'''
    '''## Findings\n\nBlocking and polish issues with evidence.\n\n'''
    '''## Adversarial QA\n\nScenario ledger and proven holes from the destructive pass.\n\n'''
    '''## Not Tested\n\nExplicit gaps and residual risk.\n\n'''
    '''## Merge Decision\n\nFinal recommendation.\n''',
    encoding='utf-8',
  )
  print(path)


if __name__ == '__main__':
  main()
