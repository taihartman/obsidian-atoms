#!/usr/bin/env python3
"""Portable, stack-neutral security-contract drift guard.

This is the vendored guard for the security-contract-framework method (see
SKILL.md at the repo root of this skill). It validates a project's access
matrix against its declared schema, checks doc-frontmatter governance, checks
row-ID-to-test linkage in both directions, and detects staleness between the
machine-readable matrix and its generated human-readable view.

It is a port of Aploma's scripts/security/validate_firestore_contract.dart,
minus the Firestore-rules-path extraction check (extractRuleMatchPaths /
"missing matrix coverage for Firestore rule path"). That check is backend
coupled (it greps firestore.rules match blocks) and is a per-project
extension, not part of this portable core. A project that wants it can add
it in its own vendored copy or an adapter script that wraps this one.

Usage:
    validate_contract.py validate [--config CONFIG] [--root ROOT]
    validate_contract.py generate-view [--config CONFIG] [--root ROOT]

Path resolution order (this is load-bearing, read before editing):
    1. --config defaults to "./contract.config.yaml" (relative to the
       current working directory the script is invoked from).
    2. --root defaults to the directory that CONTAINS the resolved config
       file (not the current working directory).
    3. Every path named INSIDE the config (matrix, schema, generated_view,
       docs_dir, and every entry in test_globs) is resolved relative to
       --root, not relative to the config file's own directory beyond that,
       and not relative to the caller's cwd.
    This makes each fixture (or each real project) self-contained: put
    contract.config.yaml at the project's security-docs root, point --root
    at that same root (or let it default), and every other path in the
    config is just a project-relative path from there.

Dependencies: PyYAML (stdlib otherwise). If PyYAML is missing, this prints a
one-line install hint to stderr and exits non-zero instead of crashing with
an ImportError traceback. That graceful path is a required feature, not a
bug: this guard must degrade cleanly on a bare python3 with no project venv.

Linkage-marker convention (matches references/firebase.md section 2, "Row-ID
linkage header"):
    A test file declares matrix-row coverage via a comment block introduced
    by a line that, after stripping leading whitespace and common comment
    syntax (//, #, /*, *), STARTS WITH the phrase "Matrix coverage"
    (case-sensitive, matches the firebase.md worked example "Matrix coverage
    includes:" / "Matrix coverage:"). A line that merely mentions the phrase
    in passing (e.g. prose explaining the convention itself) does not count,
    the phrase must lead the line.

    Every line from that marker line onward, up to the first blank line (a
    line with no non-whitespace content) or a line closing a block comment
    (contains "*/"), is scanned for tokens matching the schema's
    row_id_pattern (unanchored, so multiple ids per line are all found).
    All matches across those lines are the file's declared linkage set. A
    file may contain more than one such block; the declared set is the
    union of all of them.

    A row-ID-shaped token that appears OUTSIDE any such block (e.g. as a
    plain string constant, an emulator project id, part of unrelated prose)
    is not part of the declared linkage set and must not affect forward or
    reverse linkage checks.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
import re
import sys
from dataclasses import dataclass, field


def _die_missing_yaml() -> None:
    sys.stderr.write(
        "validate_contract.py requires PyYAML. Install it with: "
        "pip install pyyaml\n"
    )
    sys.exit(1)


try:
    import yaml
except ImportError:  # pragma: no cover - exercised via fixture subprocess test
    _die_missing_yaml()
    raise SystemExit(1)  # unreachable, keeps type-checkers happy


# --------------------------------------------------------------------------
# Result accumulator
# --------------------------------------------------------------------------


@dataclass
class ValidationResult:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    needs_decision_ids: list[str] = field(default_factory=list)

    def error(self, path: str, message: str) -> None:
        self.errors.append(f"{path}: {message}")

    def warn(self, path: str, message: str) -> None:
        self.warnings.append(f"{path}: {message}")


# --------------------------------------------------------------------------
# Loading helpers
# --------------------------------------------------------------------------


def load_yaml_file(path: str) -> object:
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Missing YAML file: {path}")
    # errors="replace" so a corrupt/binary file does not raise
    # UnicodeDecodeError; a genuine parse problem then surfaces as a clean
    # YAMLError below, which callers translate into an ERROR finding.
    with open(path, "r", encoding="utf-8", errors="replace") as handle:
        raw = handle.read()
    try:
        return yaml.safe_load(raw)
    except yaml.YAMLError as exc:
        raise ValueError(f"{path}: could not parse YAML: {exc}") from exc


def resolve_config_path(config_arg: str) -> str:
    return os.path.abspath(config_arg)


def resolve_root(root_arg: str | None, config_path: str) -> str:
    if root_arg is not None:
        return os.path.abspath(root_arg)
    return os.path.dirname(config_path)


def resolve(root: str, relative_path: str) -> str:
    return os.path.normpath(os.path.join(root, relative_path))


# --------------------------------------------------------------------------
# Frontmatter parsing
# --------------------------------------------------------------------------


def read_frontmatter(path: str) -> dict | None:
    if not os.path.isfile(path):
        return None
    with open(path, "r", encoding="utf-8") as handle:
        text = handle.read()
    if not text.startswith("---\n") and not text.startswith("---\r\n"):
        return None
    end = text.find("\n---", 4)
    if end == -1:
        return None
    yaml_text = text[4:end]
    loaded = yaml.safe_load(yaml_text)
    if not isinstance(loaded, dict):
        return None
    return loaded


DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def is_real_date(value: object) -> bool:
    """True for a real calendar date. PyYAML auto-parses an unquoted
    YYYY-MM-DD scalar into a datetime.date, so both that and a plain
    YYYY-MM-DD string are accepted; anything else (None, a placeholder
    string, a malformed date) is not.
    """
    import datetime

    if isinstance(value, datetime.date):
        return True
    if not isinstance(value, str):
        return False
    if not DATE_PATTERN.match(value):
        return False
    year, month, day = value.split("-")
    try:
        datetime.date(int(year), int(month), int(day))
    except ValueError:
        return False
    return True


# --------------------------------------------------------------------------
# Row shape validation
# --------------------------------------------------------------------------


def as_str_list(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value]
    return []


def collect_extension_fields(schema: dict) -> set[str]:
    """Opt-in extra row fields a project's schema declares via
    extension_fields. Absent/commented (the template default) means no
    extra fields are allowed, so the allowed set is exactly required_fields.
    """
    raw = schema.get("extension_fields")
    if not isinstance(raw, dict):
        return set()
    return {str(key) for key in raw.keys()}


def validate_matrix_rows(
    rows: list[dict],
    schema: dict,
    matrix_path: str,
    result: ValidationResult,
) -> None:
    required_fields = as_str_list(schema.get("required_fields"))
    allowed_statuses = set(as_str_list(schema.get("row_status_values")))
    allowed_operations = set(as_str_list(schema.get("operation_values")))
    allowed_identity_types = set(as_str_list(schema.get("identity_type_values")))
    row_id_pattern = re.compile(schema.get("row_id_pattern", r"^[A-Z][A-Z0-9_]+_[0-9]{3}$"))
    extension_fields = collect_extension_fields(schema)
    allowed_fields = set(required_fields) | extension_fields

    seen_ids: set[str] = set()

    for row in rows:
        if not isinstance(row, dict):
            result.error(matrix_path, f"matrix row is not a mapping: {row!r}")
            continue

        row_id = row.get("id")
        if not isinstance(row_id, str) or not row_id:
            result.error(matrix_path, f"matrix row has missing or invalid id: {row!r}")
            row_label = "<unknown id>"
        else:
            row_label = row_id
            if not row_id_pattern.match(row_id):
                result.error(matrix_path, f"{row_id} does not match row_id_pattern")
            if row_id in seen_ids:
                result.error(matrix_path, f"duplicate matrix row id: {row_id}")
            seen_ids.add(row_id)

        for required_field in required_fields:
            if required_field not in row:
                result.error(matrix_path, f"{row_label} is missing required field: {required_field}")

        for key in row.keys():
            if key not in allowed_fields:
                result.error(
                    matrix_path,
                    f"{row_label} has unknown field not declared in required_fields "
                    f"or extension_fields: {key}",
                )

        status = row.get("status")
        if not isinstance(status, str) or status not in allowed_statuses:
            result.error(matrix_path, f"{row_label} has invalid status: {status!r}")
        elif status == "needs-decision" and isinstance(row_id, str):
            result.needs_decision_ids.append(row_id)

        operation = row.get("operation")
        if operation is not None and (
            not isinstance(operation, str) or operation not in allowed_operations
        ):
            result.error(matrix_path, f"{row_label} has invalid operation: {operation!r}")

        identity_type = row.get("identityType")
        if identity_type is not None and (
            not isinstance(identity_type, str) or identity_type not in allowed_identity_types
        ):
            result.error(matrix_path, f"{row_label} has invalid identityType: {identity_type!r}")


# --------------------------------------------------------------------------
# Doc-frontmatter governance
# --------------------------------------------------------------------------


def validate_docs(
    docs_dir: str,
    doc_frontmatter: dict,
    result: ValidationResult,
    excluded_paths: set[str] | None = None,
) -> None:
    if not os.path.isdir(docs_dir):
        result.error(docs_dir, "docs_dir does not exist")
        return

    required_keys = as_str_list(doc_frontmatter.get("required_keys"))
    allowed_statuses = set(as_str_list(doc_frontmatter.get("doc_status_values")))
    canonical_status = doc_frontmatter.get("canonical_status")

    # Real projects (Aploma, testapp) put the generated matrix view .md
    # INSIDE the security-docs dir, next to README.md. That file carries the
    # "<!-- GENERATED ... -->" header and NO YAML frontmatter, so it must be
    # exempt from the governance frontmatter check: it is generated output,
    # not a governance doc. Any path in excluded_paths is skipped, matched by
    # normalized absolute path so it works regardless of how it was joined.
    # The exclusion is scoped to exactly those paths, so a non-generated .md
    # in the same directory still gets its frontmatter checked.
    excluded_normalized = {
        os.path.normpath(os.path.abspath(path))
        for path in (excluded_paths or set())
    }

    doc_paths: list[str] = []
    for dirpath, _dirnames, filenames in os.walk(docs_dir):
        for filename in filenames:
            if not filename.endswith(".md"):
                continue
            candidate = os.path.join(dirpath, filename)
            if os.path.normpath(os.path.abspath(candidate)) in excluded_normalized:
                continue
            doc_paths.append(candidate)
    doc_paths.sort()

    for doc_path in doc_paths:
        frontmatter = read_frontmatter(doc_path)
        if frontmatter is None:
            result.error(doc_path, "missing YAML frontmatter")
            continue

        for key in required_keys:
            if key not in frontmatter:
                result.error(doc_path, f"frontmatter missing required key: {key}")

        status = frontmatter.get("status")
        if not isinstance(status, str) or status not in allowed_statuses:
            result.error(doc_path, f"invalid doc status: {status!r}")
            continue

        if status == canonical_status:
            last_verified = frontmatter.get("last_verified")
            if not is_real_date(last_verified):
                result.error(
                    doc_path,
                    f"status is {canonical_status} but last_verified is missing "
                    f"or not a real YYYY-MM-DD date: {last_verified!r}",
                )


# --------------------------------------------------------------------------
# Row-ID <-> test linkage
# --------------------------------------------------------------------------

MARKER_TOKEN = "Matrix coverage"
# The marker line must START WITH "Matrix coverage" once common leading
# comment syntax (//, #, /*, *, whitespace) is stripped. This distinguishes
# a real linkage marker (firebase.md's "Matrix coverage includes:" /
# "Matrix coverage:" convention) from prose that merely mentions the phrase
# in passing (e.g. a doc comment explaining the convention itself).
_MARKER_LINE_PATTERN = re.compile(r"^[\s/\*#]*Matrix coverage\b")


def find_test_files(root: str, test_globs: list[str]) -> list[str]:
    matched: set[str] = set()
    for pattern in test_globs:
        matched.update(_glob_recursive(root, pattern))
    return sorted(matched)


def _glob_recursive(root: str, pattern: str) -> list[str]:
    """Supports ** recursive globs relative to root, stdlib-only."""
    results: list[str] = []
    if "**" in pattern:
        prefix, _sep, suffix = pattern.partition("**")
        prefix = prefix.rstrip("/")
        suffix = suffix.lstrip("/")
        start_dir = os.path.normpath(os.path.join(root, prefix)) if prefix else root
        if not os.path.isdir(start_dir):
            return results
        for dirpath, _dirnames, filenames in os.walk(start_dir):
            for filename in filenames:
                candidate = os.path.join(dirpath, filename)
                rel = os.path.relpath(candidate, start_dir)
                rel_posix = rel.replace(os.sep, "/")
                if fnmatch.fnmatch(rel_posix, suffix) or fnmatch.fnmatch(
                    os.path.basename(candidate), suffix
                ):
                    results.append(candidate)
    else:
        full_pattern = os.path.normpath(os.path.join(root, pattern))
        base_dir = os.path.dirname(full_pattern)
        name_pattern = os.path.basename(full_pattern)
        if not os.path.isdir(base_dir):
            return results
        for filename in os.listdir(base_dir):
            if fnmatch.fnmatch(filename, name_pattern):
                results.append(os.path.join(base_dir, filename))
    return results


def _marker_token_pattern(row_id_pattern: re.Pattern[str]) -> re.Pattern[str]:
    """Build the in-line token scanner from the schema's row_id_pattern.

    row_id_pattern is a FULL-LINE match pattern (e.g. ^[A-Z][A-Z0-9_]+_[0-9]{3}$)
    meant to validate a matrix row's id field in isolation. Marker blocks
    embed ids inside comment prose (e.g. "Matrix coverage includes:
    TRIPS_CREATE_001, TRIPS_DELETE_002"), so scanning them needs the same
    token shape without the ^/$ anchors.

    Two correctness requirements this handles:
    1. TOKEN BOUNDARIES. A bare unanchored pattern matches a valid id as a
       SUBSTRING of a longer token, so a typo'd marker id like
       TRIPS_CREATE_0019 would wrongly satisfy coverage for row
       TRIPS_CREATE_001 (a false pass, the worst failure mode for a drift
       guard). We wrap the stripped pattern in identifier boundaries
       (?<![A-Za-z0-9_]) ... (?![A-Za-z0-9_]) so a match must be a whole
       token, not embedded in a longer identifier.
    2. NON-CAPTURING WRAP. A legit row_id_pattern may itself contain a
       capturing group (e.g. ^(FOO|BAR)_[0-9]{3}$). With re.findall that
       returns the GROUP text ("FOO"), not the whole id, breaking linkage
       entirely. We wrap the stripped pattern in a NON-capturing group and
       read match.group(0) (the whole match) via finditer, so any inner
       groups are ignored.
    """
    stripped = row_id_pattern.pattern
    if stripped.startswith("^"):
        stripped = stripped[1:]
    if stripped.endswith("$"):
        stripped = stripped[:-1]
    boundaried = (
        r"(?<![A-Za-z0-9_])(?:" + stripped + r")(?![A-Za-z0-9_])"
    )
    return re.compile(boundaried)


def _scan_ids(token_pattern: re.Pattern[str], line: str) -> list[str]:
    return [match.group(0) for match in token_pattern.finditer(line)]


def extract_marker_ids(text: str, row_id_pattern: re.Pattern[str]) -> tuple[set[str], bool]:
    """Returns (declared_ids, has_marker). A "Matrix coverage" block runs
    from its marker line to the first blank line or a line closing a block
    comment (contains '*/'), inclusive of the marker line itself.
    """
    token_pattern = _marker_token_pattern(row_id_pattern)
    lines = text.splitlines()
    declared: set[str] = set()
    has_marker = False
    i = 0
    while i < len(lines):
        line = lines[i]
        if _MARKER_LINE_PATTERN.match(line):
            has_marker = True
            j = i
            while j < len(lines):
                block_line = lines[j]
                declared.update(_scan_ids(token_pattern, block_line))
                if j > i and block_line.strip() == "":
                    break
                if "*/" in block_line:
                    break
                j += 1
            i = j + 1
            continue
        i += 1
    return declared, has_marker


def validate_linkage(
    rows: list[dict],
    root: str,
    test_globs: list[str],
    row_id_pattern: re.Pattern[str],
    matrix_path: str,
    result: ValidationResult,
) -> None:
    test_files = find_test_files(root, test_globs)

    file_declared_ids: dict[str, set[str]] = {}
    all_declared_ids: set[str] = set()

    for test_file in test_files:
        # errors="replace" so a binary/non-UTF-8 file matched by a test_glob
        # does not raise UnicodeDecodeError. It simply yields no marker and
        # gets a clean WARN like any other unmarked file.
        with open(test_file, "r", encoding="utf-8", errors="replace") as handle:
            text = handle.read()
        declared, has_marker = extract_marker_ids(text, row_id_pattern)
        rel_path = os.path.relpath(test_file, root)
        file_declared_ids[rel_path] = declared
        all_declared_ids.update(declared)

        if not has_marker:
            result.warn(rel_path, 'test file has no "Matrix coverage" linkage marker')

    matrix_ids = set()
    for row in rows:
        if isinstance(row, dict) and isinstance(row.get("id"), str):
            matrix_ids.add(row["id"])

    # Forward: a row claiming tests must have its id appear in some marker.
    for row in rows:
        if not isinstance(row, dict):
            continue
        row_id = row.get("id")
        if not isinstance(row_id, str):
            continue
        tests = row.get("tests")
        tests_list = tests if isinstance(tests, list) else []
        normalized = [str(t) for t in tests_list]
        if not normalized or normalized == ["none"]:
            continue
        if row_id not in all_declared_ids:
            result.error(
                matrix_path,
                f"{row_id} claims test coverage but no test file linkage marker "
                f"declares its id",
            )

    # Reverse: a marker-declared id with no matrix row is a hard error.
    for rel_path, declared in file_declared_ids.items():
        for declared_id in sorted(declared):
            if declared_id not in matrix_ids:
                result.error(
                    rel_path,
                    f'"Matrix coverage" marker declares {declared_id} but no '
                    f"matrix row has that id",
                )


# --------------------------------------------------------------------------
# Generated-view rendering + staleness
# --------------------------------------------------------------------------

VIEW_HEADER = (
    "<!-- GENERATED by validate_contract.py generate-view "
    "(do not hand-edit) -->"
)

LIST_SEPARATOR = "; "
NULL_TOKEN = "~"


def _compact_json(value: object) -> str:
    """Compact, deterministic JSON for a structured (dict/list) cell value.
    sort_keys + ensure_ascii keep the output stable across PyYAML versions
    so the staleness check never false-fails. default=str handles YAML-coerced
    scalars that json cannot natively serialize (e.g. a bare YYYY-MM-DD that
    PyYAML parsed into a datetime.date) nested inside a dataShape/notes dict,
    so generate-view never crashes with a TypeError.
    """
    return json.dumps(
        value,
        sort_keys=True,
        ensure_ascii=True,
        separators=(", ", ": "),
        default=str,
    )


def _item(value: object) -> str:
    """Render one list item: a scalar via str(), a structured item (dict or
    nested list) via compact JSON, so a list of dicts no longer emits Python
    reprs.
    """
    if isinstance(value, (dict, list)):
        return _compact_json(value)
    return str(value)


def _cell(value: object) -> str:
    if value is None:
        return NULL_TOKEN
    if isinstance(value, list):
        if not value:
            return NULL_TOKEN
        return LIST_SEPARATOR.join(_item(item) for item in value)
    if isinstance(value, dict):
        return _compact_json(value)
    return str(value)


def render_view(rows: list[dict]) -> str:
    """Canonical markdown table serialization. Deterministic across PyYAML
    versions: rows sorted by id, list cells joined by LIST_SEPARATOR, null
    or absent normalized to NULL_TOKEN, single trailing newline, no
    trailing whitespace on any line, ASCII-only.
    """
    columns = [
        "id",
        "path",
        "operation",
        "allowedActors",
        "deniedActors",
        "identityType",
        "dataShape",
        "tests",
        "threatsCovered",
        "status",
        "owner",
        "lastVerified",
        "notes",
    ]

    sortable_rows = [row for row in rows if isinstance(row, dict)]
    sortable_rows.sort(key=lambda row: str(row.get("id", "")))

    lines = [VIEW_HEADER, ""]
    header = "| " + " | ".join(columns) + " |"
    separator = "| " + " | ".join("---" for _ in columns) + " |"
    lines.append(header)
    lines.append(separator)

    for row in sortable_rows:
        cells = [_cell(row.get(column)) for column in columns]
        cells = [cell.replace("|", "\\|") for cell in cells]
        lines.append("| " + " | ".join(cells) + " |")

    rendered = "\n".join(line.rstrip() for line in lines)
    rendered = rendered.encode("ascii", "backslashreplace").decode("ascii")
    return rendered + "\n"


def normalize_for_diff(text: str) -> str:
    lines = text.splitlines()
    normalized_lines = [line.rstrip() for line in lines]
    return "\n".join(normalized_lines).rstrip("\n") + "\n"


# --------------------------------------------------------------------------
# Top-level commands
# --------------------------------------------------------------------------


REQUIRED_CONFIG_KEYS = ("matrix", "schema", "generated_view", "docs_dir")


def load_contract(config_path: str, root: str) -> tuple[dict, dict, dict, list[dict]]:
    config = load_yaml_file(config_path)
    if not isinstance(config, dict):
        raise ValueError(f"{config_path}: config root must be a mapping")

    # Validate the path keys the guard depends on are all present up front,
    # so a config missing one surfaces as a clean ERROR finding rather than
    # an uncaught KeyError traceback later when cmd_* subscripts config[...].
    for key in REQUIRED_CONFIG_KEYS:
        if key not in config:
            raise ValueError(f"{config_path}: config missing required key: {key}")

    matrix_path = resolve(root, config["matrix"])
    schema_path = resolve(root, config["schema"])

    schema = load_yaml_file(schema_path)
    if not isinstance(schema, dict):
        raise ValueError(f"{schema_path}: schema root must be a mapping")

    matrix = load_yaml_file(matrix_path)
    if not isinstance(matrix, dict):
        raise ValueError(f"{matrix_path}: matrix root must be a mapping")

    rows = matrix.get("rows")
    if not isinstance(rows, list):
        rows = []

    return config, schema, matrix, rows


def cmd_validate(config_path: str, root: str) -> int:
    result = ValidationResult()

    try:
        config, schema, _matrix, rows = load_contract(config_path, root)
    except (FileNotFoundError, ValueError) as exc:
        sys.stderr.write(f"ERROR: {exc}\n")
        return 1

    matrix_path = resolve(root, config["matrix"])
    generated_view_path = resolve(root, config["generated_view"])
    docs_dir = resolve(root, config["docs_dir"])
    test_globs = as_str_list(config.get("test_globs"))

    if len(rows) == 0:
        result.error(matrix_path, "matrix has zero rows")

    row_id_pattern_str = schema.get(
        "row_id_pattern", config.get("row_id_pattern", r"^[A-Z][A-Z0-9_]+_[0-9]{3}$")
    )
    row_id_pattern = re.compile(row_id_pattern_str)

    validate_matrix_rows(rows, schema, matrix_path, result)

    doc_frontmatter = schema.get("doc_frontmatter", config.get("doc_frontmatter", {}))
    if not isinstance(doc_frontmatter, dict):
        doc_frontmatter = {}
    validate_docs(
        docs_dir,
        doc_frontmatter,
        result,
        excluded_paths={generated_view_path},
    )

    validate_linkage(rows, root, test_globs, row_id_pattern, matrix_path, result)

    if len(rows) > 0:
        expected_view = render_view(rows)
        if not os.path.isfile(generated_view_path):
            result.error(generated_view_path, "generated view is stale, run generate-view")
        else:
            with open(generated_view_path, "r", encoding="utf-8") as handle:
                actual_view = handle.read()
            if normalize_for_diff(actual_view) != normalize_for_diff(expected_view):
                result.error(generated_view_path, "generated view is stale, run generate-view")

    for warning in result.warnings:
        sys.stdout.write(f"WARN: {warning}\n")
    for error in result.errors:
        sys.stderr.write(f"ERROR: {error}\n")

    if result.needs_decision_ids:
        sys.stdout.write(
            f"{len(result.needs_decision_ids)} matrix row(s) marked "
            f"needs-decision: {', '.join(sorted(result.needs_decision_ids))}\n"
        )

    if result.errors:
        sys.stderr.write(
            f"Security contract validation failed: {len(result.errors)} "
            f"error(s), {len(result.warnings)} warning(s)\n"
        )
        return 1

    sys.stdout.write(
        f"Security contract validation passed: {len(rows)} matrix rows, "
        f"{len(result.warnings)} warning(s)\n"
    )
    return 0


def cmd_generate_view(config_path: str, root: str) -> int:
    try:
        config, _schema, _matrix, rows = load_contract(config_path, root)
    except (FileNotFoundError, ValueError) as exc:
        sys.stderr.write(f"ERROR: {exc}\n")
        return 1

    generated_view_path = resolve(root, config["generated_view"])
    rendered = render_view(rows)

    os.makedirs(os.path.dirname(generated_view_path), exist_ok=True)
    with open(generated_view_path, "w", encoding="utf-8") as handle:
        handle.write(rendered)

    sys.stdout.write(f"Wrote generated view: {generated_view_path} ({len(rows)} rows)\n")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="validate_contract.py",
        description="Portable, stack-neutral security-contract drift guard.",
    )
    parser.add_argument("command", choices=["validate", "generate-view"])
    parser.add_argument("--config", default="./contract.config.yaml")
    parser.add_argument("--root", default=None)
    args = parser.parse_args(argv)

    config_path = resolve_config_path(args.config)
    root = resolve_root(args.root, config_path)

    if not os.path.isfile(config_path):
        sys.stderr.write(f"ERROR: config file not found: {config_path}\n")
        return 1

    if args.command == "validate":
        return cmd_validate(config_path, root)
    return cmd_generate_view(config_path, root)


if __name__ == "__main__":
    sys.exit(main())
