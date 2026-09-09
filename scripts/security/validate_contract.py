#!/usr/bin/env python3
"""Vendored security-contract guard. Requires PyYAML."""
from __future__ import annotations

import argparse
import glob
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "docs/security/contracts/contract.config.yaml"


def load(path: Path):
    with path.open(encoding="utf-8") as stream:
        return yaml.safe_load(stream)


def frontmatter(path: Path):
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return None
    end = text.find("\n---\n", 4)
    return yaml.safe_load(text[4:end]) if end >= 0 else None


def validate() -> list[str]:
    errors: list[str] = []
    config = load(CONFIG)
    schema = load(ROOT / config["schema"])
    matrix = load(ROOT / config["matrix"])
    rows = matrix.get("rows", [])
    ids: set[str] = set()
    test_text = "\n".join(
        Path(p).read_text(encoding="utf-8", errors="replace")
        for pattern in config["test_globs"]
        for p in glob.glob(str(ROOT / pattern), recursive=True)
    )
    required = set(schema["required_fields"])
    for index, row in enumerate(rows):
        missing = required - set(row)
        if missing:
            errors.append(f"row {index} missing: {', '.join(sorted(missing))}")
            continue
        row_id = row["id"]
        if row_id in ids:
            errors.append(f"duplicate row id: {row_id}")
        ids.add(row_id)
        if not re.fullmatch(schema["row_id_pattern"], row_id):
            errors.append(f"invalid row id: {row_id}")
        if row["operation"] not in schema["operation_values"]:
            errors.append(f"{row_id}: invalid operation")
        if row["identityType"] not in schema["identity_type_values"]:
            errors.append(f"{row_id}: invalid identity type")
        if row["status"] not in schema["row_status_values"]:
            errors.append(f"{row_id}: invalid status")
        if row["tests"] != ["none"] and row_id not in test_text:
            errors.append(f"{row_id}: no row-ID-linked test")

    governance = schema["doc_frontmatter"]
    for path in sorted((ROOT / config["docs_dir"]).glob("*.md")):
        fm = frontmatter(path)
        if fm is None:
            errors.append(f"{path.relative_to(ROOT)}: missing frontmatter")
            continue
        missing = set(governance["required_keys"]) - set(fm)
        if missing:
            errors.append(f"{path.relative_to(ROOT)}: missing frontmatter keys {sorted(missing)}")
        if fm.get("status") not in governance["doc_status_values"]:
            errors.append(f"{path.relative_to(ROOT)}: invalid status")
        if fm.get("status") == governance["canonical_status"] and not re.fullmatch(
            r"\d{4}-\d{2}-\d{2}", str(fm.get("last_verified", ""))
        ):
            errors.append(f"{path.relative_to(ROOT)}: canonical doc needs review date")
    return errors


def generate_view() -> None:
    config = load(CONFIG)
    rows = load(ROOT / config["matrix"])["rows"]
    last_verified = max(str(row["lastVerified"]) for row in rows)
    lines = [
        "---",
        "status: canonical",
        "owner: product-engineering",
        f"last_verified: {last_verified}",
        "canonical_for: [generated-access-matrix-view]",
        "supersedes: []",
        "superseded_by: null",
        "---",
        "",
        "# Access matrix",
        "",
        "Generated from `access-matrix.yaml`. Do not edit by hand.",
        "",
        "| Row | Route | Operation | Authority | Status |",
        "|---|---|---|---|---|",
    ]
    for row in rows:
        actors = "; ".join(row["allowedActors"]).replace("|", "\\|")
        lines.append(
            f"| `{row['id']}` | `{row['path']}` | {row['operation']} | {actors} | {row['status']} |"
        )
    (ROOT / config["generated_view"]).write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["validate", "generate-view"])
    args = parser.parse_args()
    if args.command == "generate-view":
        generate_view()
        print("generated access-matrix.md")
        return 0
    errors = validate()
    if errors:
        print("\n".join(f"ERROR: {e}" for e in errors), file=sys.stderr)
        return 1
    print("security contract valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
