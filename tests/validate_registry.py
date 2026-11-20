#!/usr/bin/env python3
"""
OpenNeuroAtlas — Registry Schema & Cross-Record Integrity Validator

Python 3.12 stdlib-only CLI & unittest suite validating:
  - schemas/registry-schema.json integrity and regex compilation
  - data/datasets.json, data/models.json, data/challenges.json file envelopes
  - Per-record schema compliance (types, nullability, lengths, ranges, patterns,
    controlled vocabularies, additionalProperties=false, nested citation objects)
  - Strict curated bounds:
      * cohortSize is non-negative int (matching schema >=1) or null
      * year in [2005, 2027] (and challenge yearsActive start/end years in [2005, 2027])
      * minimum record counts: >=20 datasets, >=12 models, >=8 challenges
  - Cross-record integrity:
      * zero duplicate IDs per collection and globally across all collections
      * zero duplicate bibtexKeys per collection (case-insensitive)
      * weightsUrl requires weightsAvailable == true
  - URL hygiene:
      * all URLs start with https:// and have valid non-forbidden hosts
      * zero URLs contain 'vertexaisearch' or 'grounding-api-redirect'

Usage:
  python tests/validate_registry.py
  python tests/validate_registry.py --strict
  python tests/validate_registry.py --check-urls
  python -m unittest tests/validate_registry.py
"""

from __future__ import annotations

import argparse
import datetime
import json
import re
import sys
import tempfile
import unittest
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
COLLECTIONS: tuple[str, ...] = ("datasets", "models", "challenges")
MIN_RECORD_COUNTS: dict[str, int] = {
    "datasets": 20,
    "models": 12,
    "challenges": 8,
}
CURATED_YEAR_MIN = 2005
CURATED_YEAR_MAX = 2027
FORBIDDEN_URL_SUBSTRINGS: tuple[str, ...] = (
    "vertexaisearch",
    "grounding-api-redirect",
)
DEFAULT_FORBIDDEN_URL_HOSTS: frozenset[str] = frozenset(
    {
        "localhost",
        "127.0.0.1",
        "0.0.0.0",
        "example.com",
        "example.org",
        "placeholder.com",
    }
)


@dataclass(frozen=True)
class ValidationIssue:
    """Single structured validation error or warning."""

    level: str  # "ERROR" | "WARN"
    source: str
    index: int | None
    record_id: str | None
    field_path: str
    message: str

    def format(self) -> str:
        loc = self.source
        if self.index is not None:
            loc = f"{loc}[{self.index}]"
        if self.record_id:
            loc = f"{loc} (id={self.record_id})"
        field_part = f" -> {self.field_path}" if self.field_path else ""
        return f"[{self.level}] {loc}{field_part}: {self.message}"


@dataclass
class ValidationReport:
    """Aggregated validation results across schema and all collections."""

    counts: dict[str, int] = field(default_factory=dict)
    errors: list[ValidationIssue] = field(default_factory=list)
    warnings: list[ValidationIssue] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return len(self.errors) == 0


def _is_strict_int(value: Any) -> bool:
    """Return True iff value is an int and NOT a bool (Python bool subclasses int)."""
    return isinstance(value, int) and not isinstance(value, bool)


def load_and_check_schema(schema_path: Path) -> tuple[dict[str, Any] | None, list[ValidationIssue]]:
    """Load schemas/registry-schema.json, verify required structure, and compile regexes."""
    issues: list[ValidationIssue] = []
    source = "schemas/registry-schema.json"

    if not schema_path.is_file():
        issues.append(
            ValidationIssue("ERROR", source, None, None, "", f"Schema file not found: {schema_path}")
        )
        return None, issues

    try:
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        issues.append(
            ValidationIssue("ERROR", source, None, None, "", f"Invalid JSON syntax: {exc}")
        )
        return None, issues

    if not isinstance(schema, dict):
        issues.append(
            ValidationIssue("ERROR", source, None, None, "", "Root schema must be a JSON object.")
        )
        return None, issues

    required_top_keys = (
        "schemaVersion",
        "fileEnvelope",
        "vocabularies",
        "definitions",
        "recordTypes",
        "integrityRules",
    )
    for key in required_top_keys:
        if key not in schema:
            issues.append(
                ValidationIssue("ERROR", source, None, None, key, f"Missing required schema key '{key}'.")
            )

    if issues:
        return schema, issues

    # Verify definitions.citation and all 3 recordTypes exist
    definitions = schema.get("definitions", {})
    if "citation" not in definitions or not isinstance(definitions["citation"], dict):
        issues.append(
            ValidationIssue("ERROR", source, None, None, "definitions.citation", "Missing citation definition.")
        )

    record_types = schema.get("recordTypes", {})
    for col in COLLECTIONS:
        if col not in record_types or not isinstance(record_types[col], dict):
            issues.append(
                ValidationIssue(
                    "ERROR",
                    source,
                    None,
                    None,
                    f"recordTypes.{col}",
                    f"Missing recordTypes entry for '{col}'.",
                )
            )

    # Pre-compile every regex pattern declared in schema to verify regex validity
    def _check_patterns(props: dict[str, Any], prefix: str) -> None:
        if not isinstance(props, dict):
            return
        for prop_name, prop_spec in props.items():
            if not isinstance(prop_spec, dict):
                continue
            pattern = prop_spec.get("pattern")
            if pattern is not None:
                try:
                    re.compile(pattern)
                except re.error as exc:
                    issues.append(
                        ValidationIssue(
                            "ERROR",
                            source,
                            None,
                            None,
                            f"{prefix}.{prop_name}.pattern",
                            f"Invalid regex '{pattern}': {exc}",
                        )
                    )

    _check_patterns(schema.get("fileEnvelope", {}).get("properties", {}), "fileEnvelope.properties")
    for def_name, def_spec in definitions.items():
        if isinstance(def_spec, dict):
            _check_patterns(def_spec.get("properties", {}), f"definitions.{def_name}.properties")
    for col, rt_spec in record_types.items():
        if isinstance(rt_spec, dict):
            _check_patterns(rt_spec.get("properties", {}), f"recordTypes.{col}.properties")

    return schema, issues


def validate_url(
    url: str,
    pattern: str | None,
    forbidden_hosts: frozenset[str],
) -> list[str]:
    """Validate an HTTPS URL string for protocol, host hygiene, pattern, and banned substrings."""
    errors: list[str] = []

    if not url.startswith("https://"):
        errors.append("URL must start with 'https://'.")

    lower_url = url.lower()
    for banned in FORBIDDEN_URL_SUBSTRINGS:
        if banned in lower_url:
            errors.append(f"URL must not contain forbidden substring '{banned}'.")

    if pattern and not re.search(pattern, url):
        errors.append(f"URL does not match required pattern '{pattern}'.")

    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https":
        errors.append(f"URL scheme must be 'https', got '{parsed.scheme}'.")

    hostname = (parsed.hostname or "").lower()
    if not hostname or "." not in hostname:
        errors.append("URL must include a valid public hostname containing a dot.")
    else:
        for forbidden in forbidden_hosts:
            if hostname == forbidden or hostname.endswith(f".{forbidden}"):
                errors.append(f"URL host '{hostname}' is forbidden ({forbidden}).")
                break

    return errors


def _validate_field_value(
    value: Any,
    prop_spec: dict[str, Any],
    field_path: str,
    schema: dict[str, Any],
    forbidden_hosts: frozenset[str],
    errors: list[tuple[str, str]],
) -> None:
    """Validate one field value recursively against its schema property specification."""
    if value is None:
        if prop_spec.get("nullable") is True:
            return
        errors.append((field_path, "Value cannot be null."))
        return

    expected_type = prop_spec.get("type")
    vocabularies = schema.get("vocabularies", {})

    if expected_type == "string":
        if not isinstance(value, str):
            errors.append((field_path, f"Expected string, got {type(value).__name__}."))
            return

        min_len = prop_spec.get("minLength")
        max_len = prop_spec.get("maxLength")
        if isinstance(min_len, int) and min_len > 0 and len(value.strip()) == 0:
            errors.append((field_path, "String cannot be empty or whitespace-only."))
            return
        if isinstance(min_len, int) and len(value) < min_len:
            errors.append((field_path, f"Length {len(value)} is shorter than minimum {min_len}."))
        if isinstance(max_len, int) and len(value) > max_len:
            errors.append((field_path, f"Length {len(value)} exceeds maximum {max_len}."))

        if prop_spec.get("format") == "https-url":
            for url_err in validate_url(value, prop_spec.get("pattern"), forbidden_hosts):
                errors.append((field_path, url_err))
        else:
            pattern = prop_spec.get("pattern")
            if pattern and not re.search(pattern, value):
                errors.append((field_path, f"Value '{value}' does not match pattern '{pattern}'."))

        enum_vals = prop_spec.get("enum")
        if isinstance(enum_vals, list) and value not in enum_vals:
            errors.append((field_path, f"Value '{value}' not in allowed enum {enum_vals}."))

        vocab_ref = prop_spec.get("vocabRef")
        if vocab_ref:
            vocab = vocabularies.get(vocab_ref)
            if not isinstance(vocab, list):
                errors.append((field_path, f"Schema vocabulary '{vocab_ref}' not found."))
            elif value not in vocab:
                errors.append(
                    (field_path, f"Value '{value}' is not in controlled vocabulary '{vocab_ref}'.")
                )

    elif expected_type == "integer":
        if not _is_strict_int(value):
            errors.append((field_path, f"Expected integer, got {type(value).__name__} ({value!r})."))
            return
        minimum = prop_spec.get("minimum")
        maximum = prop_spec.get("maximum")
        if isinstance(minimum, int) and value < minimum:
            errors.append((field_path, f"Value {value} is below minimum {minimum}."))
        if isinstance(maximum, int) and value > maximum:
            errors.append((field_path, f"Value {value} exceeds maximum {maximum}."))

    elif expected_type == "boolean":
        if not isinstance(value, bool):
            errors.append((field_path, f"Expected boolean, got {type(value).__name__}."))

    elif expected_type == "array":
        if not isinstance(value, list):
            errors.append((field_path, f"Expected array, got {type(value).__name__}."))
            return

        min_items = prop_spec.get("minItems")
        if isinstance(min_items, int) and len(value) < min_items:
            errors.append(
                (field_path, f"Array has {len(value)} item(s); minimum required is {min_items}.")
            )

        vocab_ref = prop_spec.get("vocabRef")
        vocab = vocabularies.get(vocab_ref) if vocab_ref else None
        if vocab_ref and not isinstance(vocab, list):
            errors.append((field_path, f"Schema vocabulary '{vocab_ref}' not found."))

        item_type = prop_spec.get("items", {}).get("type")
        unique_items = prop_spec.get("uniqueItems") is True
        seen: set[Any] = set()

        for idx, elem in enumerate(value):
            elem_path = f"{field_path}[{idx}]"
            if item_type == "string":
                if not isinstance(elem, str) or not elem.strip():
                    errors.append((elem_path, "Array element must be a non-empty string."))
                    continue
            if unique_items:
                if elem in seen:
                    errors.append((elem_path, f"Duplicate array item '{elem}' is not allowed."))
                else:
                    seen.add(elem)
            if isinstance(vocab, list) and elem not in vocab:
                errors.append(
                    (elem_path, f"Value '{elem}' is not in controlled vocabulary '{vocab_ref}'.")
                )

    elif expected_type == "object":
        if not isinstance(value, dict):
            errors.append((field_path, f"Expected object, got {type(value).__name__}."))
            return
        obj_ref = prop_spec.get("objectRef")
        obj_spec = schema.get("definitions", {}).get(obj_ref) if obj_ref else prop_spec
        if isinstance(obj_spec, dict):
            _validate_object_spec(value, obj_spec, field_path, schema, forbidden_hosts, errors)


def _validate_object_spec(
    obj: dict[str, Any],
    spec: dict[str, Any],
    prefix_path: str,
    schema: dict[str, Any],
    forbidden_hosts: frozenset[str],
    errors: list[tuple[str, str]],
) -> None:
    """Validate a dict against a schema object definition (recordType or definition)."""
    properties = spec.get("properties", {})
    required_fields = spec.get("required", [])
    prefix = f"{prefix_path}." if prefix_path else ""

    if spec.get("additionalProperties") is False:
        for key in obj:
            if key not in properties:
                errors.append((f"{prefix}{key}", f"Unknown field '{key}' is not allowed by schema."))

    for req_key in required_fields:
        if req_key not in obj:
            errors.append((f"{prefix}{req_key}", f"Missing required field '{req_key}'."))

    for key, prop_spec in properties.items():
        if key not in obj:
            continue
        _validate_field_value(obj[key], prop_spec, f"{prefix}{key}", schema, forbidden_hosts, errors)


def validate_record(
    record: Any,
    record_type: str,
    schema: dict[str, Any],
    *,
    enforce_curated_year_range: bool = True,
) -> list[tuple[str, str]]:
    """
    Validate a single record against schema['recordTypes'][record_type] plus
    curated cohortSize, year [2005, 2027], URL hygiene, and cross-field rules.

    Returns a list of (field_path, message) error tuples.
    """
    errors: list[tuple[str, str]] = []

    if record_type not in schema.get("recordTypes", {}):
        return [("", f"Unknown recordType '{record_type}'.")]

    if not isinstance(record, dict):
        return [("", f"Record must be a JSON object, got {type(record).__name__}.")]

    forbidden_hosts = frozenset(
        h.lower()
        for h in schema.get("integrityRules", {}).get("forbiddenUrlHosts", DEFAULT_FORBIDDEN_URL_HOSTS)
    )
    type_spec = schema["recordTypes"][record_type]

    _validate_object_spec(record, type_spec, "", schema, forbidden_hosts, errors)

    # Extra strict checks explicitly required for curated OpenNeuroAtlas records
    if record_type == "datasets":
        cohort_size = record.get("cohortSize")
        if cohort_size is not None:
            if not _is_strict_int(cohort_size) or cohort_size < 0:
                errors.append(
                    ("cohortSize", f"cohortSize must be a non-negative integer or null, got {cohort_size!r}.")
                )

    if enforce_curated_year_range:
        if record_type in ("datasets", "models"):
            year_val = record.get("year")
            if _is_strict_int(year_val) and not (CURATED_YEAR_MIN <= year_val <= CURATED_YEAR_MAX):
                errors.append(
                    (
                        "year",
                        f"year {year_val} is outside required range [{CURATED_YEAR_MIN}, {CURATED_YEAR_MAX}].",
                    )
                )
        elif record_type == "challenges":
            years_active = record.get("yearsActive")
            if isinstance(years_active, str):
                found_years = [int(y) for y in re.findall(r"\d{4}", years_active)]
                if found_years:
                    start_year = found_years[0]
                    if not (CURATED_YEAR_MIN <= start_year <= CURATED_YEAR_MAX):
                        errors.append(
                            (
                                "yearsActive",
                                f"Start year {start_year} in '{years_active}' is outside [{CURATED_YEAR_MIN}, {CURATED_YEAR_MAX}].",
                            )
                        )
                    for y in found_years[1:]:
                        if y < start_year:
                            errors.append(
                                (
                                    "yearsActive",
                                    f"Year {y} in '{years_active}' precedes start year {start_year}.",
                                )
                            )
                        elif y > CURATED_YEAR_MAX:
                            errors.append(
                                (
                                    "yearsActive",
                                    f"Year {y} in '{years_active}' exceeds maximum {CURATED_YEAR_MAX}.",
                                )
                            )

    # Cross-field consistency rule: models with weightsUrl must have weightsAvailable == True
    integrity = schema.get("integrityRules", {})
    if record_type == "models" and integrity.get("weightsUrlRequiresWeightsAvailable", True):
        weights_url = record.get("weightsUrl")
        if weights_url is not None and weights_url != "" and record.get("weightsAvailable") is not True:
            errors.append(
                ("weightsAvailable", "weightsAvailable must be true whenever weightsUrl is non-null.")
            )

    return errors


def validate_collection_file(
    data_path: Path,
    record_type: str,
    schema: dict[str, Any],
    *,
    check_min_counts: bool = True,
) -> tuple[list[dict[str, Any]], list[ValidationIssue]]:
    """Validate one data/<record_type>.json file envelope, records, and collection uniqueness."""
    issues: list[ValidationIssue] = []
    source = f"data/{record_type}.json"

    if not data_path.is_file():
        issues.append(
            ValidationIssue("ERROR", source, None, None, "", f"Data file not found: {data_path}")
        )
        return [], issues

    try:
        payload = json.loads(data_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        issues.append(
            ValidationIssue("ERROR", source, None, None, "", f"Invalid JSON syntax: {exc}")
        )
        return [], issues

    if not isinstance(payload, dict):
        issues.append(
            ValidationIssue("ERROR", source, None, None, "", "Root JSON must be a file envelope object.")
        )
        return [], issues

    # Validate envelope against schema.fileEnvelope
    envelope_spec = schema.get("fileEnvelope", {})
    forbidden_hosts = frozenset(
        h.lower()
        for h in schema.get("integrityRules", {}).get("forbiddenUrlHosts", DEFAULT_FORBIDDEN_URL_HOSTS)
    )
    env_errors: list[tuple[str, str]] = []
    _validate_object_spec(payload, envelope_spec, "", schema, forbidden_hosts, env_errors)
    for fpath, msg in env_errors:
        issues.append(ValidationIssue("ERROR", source, None, None, fpath, msg))

    integrity = schema.get("integrityRules", {})
    if integrity.get("enforceSchemaVersionMatch", True):
        if payload.get("schemaVersion") != schema.get("schemaVersion"):
            issues.append(
                ValidationIssue(
                    "ERROR",
                    source,
                    None,
                    None,
                    "schemaVersion",
                    f"Envelope schemaVersion '{payload.get('schemaVersion')}' does not match schema '{schema.get('schemaVersion')}'.",
                )
            )

    if integrity.get("enforceEnvelopeRecordTypeMatchesFilename", True):
        if payload.get("recordType") != record_type:
            issues.append(
                ValidationIssue(
                    "ERROR",
                    source,
                    None,
                    None,
                    "recordType",
                    f"Envelope recordType '{payload.get('recordType')}' does not match filename '{record_type}'.",
                )
            )

    last_updated = payload.get("lastUpdated")
    if isinstance(last_updated, str):
        try:
            datetime.date.fromisoformat(last_updated)
        except ValueError:
            issues.append(
                ValidationIssue(
                    "ERROR",
                    source,
                    None,
                    None,
                    "lastUpdated",
                    f"Invalid ISO calendar date '{last_updated}'.",
                )
            )

    records = payload.get("records")
    if not isinstance(records, list):
        return [], issues

    if check_min_counts:
        min_required = MIN_RECORD_COUNTS.get(record_type, 0)
        if len(records) < min_required:
            issues.append(
                ValidationIssue(
                    "ERROR",
                    source,
                    None,
                    None,
                    "records",
                    f"Collection has {len(records)} record(s), below minimum required count of {min_required}.",
                )
            )

    seen_ids: dict[str, int] = {}
    seen_bibtex_keys: dict[str, tuple[int, str]] = {}

    for idx, record in enumerate(records):
        rec_id = record.get("id") if isinstance(record, dict) and isinstance(record.get("id"), str) else None
        rec_errors = validate_record(record, record_type, schema)
        for fpath, msg in rec_errors:
            issues.append(ValidationIssue("ERROR", source, idx, rec_id, fpath, msg))

        if isinstance(record, dict):
            if isinstance(rec_id, str) and rec_id:
                if rec_id in seen_ids:
                    issues.append(
                        ValidationIssue(
                            "ERROR",
                            source,
                            idx,
                            rec_id,
                            "id",
                            f"Duplicate id '{rec_id}' within {source} (first seen at index {seen_ids[rec_id]}).",
                        )
                    )
                else:
                    seen_ids[rec_id] = idx

            citation = record.get("citation")
            if isinstance(citation, dict):
                bkey = citation.get("bibtexKey")
                if isinstance(bkey, str) and bkey:
                    bkey_low = bkey.lower()
                    if bkey_low in seen_bibtex_keys:
                        first_idx, first_raw = seen_bibtex_keys[bkey_low]
                        issues.append(
                            ValidationIssue(
                                "ERROR",
                                source,
                                idx,
                                rec_id,
                                "citation.bibtexKey",
                                f"Duplicate bibtexKey '{bkey}' within {source} (collides with '{first_raw}' at index {first_idx}).",
                            )
                        )
                    else:
                        seen_bibtex_keys[bkey_low] = (idx, bkey)

    valid_records = [r for r in records if isinstance(r, dict)]
    return valid_records, issues


def _probe_url_live(url: str, timeout: float = 10.0) -> tuple[bool, str]:
    """Perform a polite HTTP HEAD (with GET fallback) liveness check using stdlib urllib."""
    headers = {"User-Agent": "OpenNeuroAtlas-Registry-Validator/1.0 (+https://github.com)"}
    for method in ("HEAD", "GET"):
        req = urllib.request.Request(url, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                status = getattr(resp, "status", 200)
                if 200 <= status < 400:
                    return True, f"HTTP {status}"
                return False, f"HTTP {status}"
        except urllib.error.HTTPError as exc:
            if method == "HEAD" and exc.code in (403, 405, 501):
                continue
            return False, f"HTTP {exc.code}"
        except urllib.error.URLError as exc:
            return False, f"URL error: {exc.reason}"
        except TimeoutError:
            return False, "Request timed out"
    return False, "Unreachable"


def validate_registry(
    root_dir: Path = REPO_ROOT,
    *,
    strict: bool = False,
    check_urls: bool = False,
    check_min_counts: bool = True,
) -> ValidationReport:
    """Run the complete OpenNeuroAtlas schema, record, cross-collection, and URL validation pipeline."""
    report = ValidationReport()
    schema_path = root_dir / "schemas" / "registry-schema.json"
    schema, schema_issues = load_and_check_schema(schema_path)
    report.errors.extend(schema_issues)
    if schema is None or schema_issues:
        return report

    global_ids: dict[str, tuple[str, int]] = {}
    url_targets: list[tuple[str, int, str | None, str, str]] = []
    enforce_global_ids = schema.get("integrityRules", {}).get("uniqueIdGlobally", True)

    for col in COLLECTIONS:
        data_path = root_dir / "data" / f"{col}.json"
        records, col_issues = validate_collection_file(
            data_path,
            col,
            schema,
            check_min_counts=check_min_counts,
        )
        report.counts[col] = len(records)
        report.errors.extend(col_issues)

        source = f"data/{col}.json"
        for idx, rec in enumerate(records):
            rec_id = rec.get("id") if isinstance(rec.get("id"), str) else None
            if enforce_global_ids and rec_id:
                if rec_id in global_ids:
                    prev_src, prev_idx = global_ids[rec_id]
                    if prev_src != source:
                        report.errors.append(
                            ValidationIssue(
                                "ERROR",
                                source,
                                idx,
                                rec_id,
                                "id",
                                f"Globally duplicate id '{rec_id}' (already defined in {prev_src}[{prev_idx}]).",
                            )
                        )
                else:
                    global_ids[rec_id] = (source, idx)

            if check_urls:
                for url_field in ("url", "paperUrl", "repoUrl", "weightsUrl"):
                    val = rec.get(url_field)
                    if isinstance(val, str) and val.startswith("https://"):
                        url_targets.append((source, idx, rec_id, url_field, val))

    if check_urls:
        checked_cache: dict[str, tuple[bool, str]] = {}
        for source, idx, rec_id, field_name, url_val in url_targets:
            if url_val not in checked_cache:
                checked_cache[url_val] = _probe_url_live(url_val)
            ok, detail = checked_cache[url_val]
            if not ok:
                level = "ERROR" if strict else "WARN"
                issue = ValidationIssue(
                    level,
                    source,
                    idx,
                    rec_id,
                    field_name,
                    f"Live URL check failed for {url_val} ({detail}).",
                )
                if strict:
                    report.errors.append(issue)
                else:
                    report.warnings.append(issue)

    return report


def _format_issues(issues: list[ValidationIssue]) -> str:
    return "\n".join(issue.format() for issue in issues)


# =============================================================================
# Python stdlib unittest Suite
# =============================================================================


class TestRegistryData(unittest.TestCase):
    """End-to-end validation tests against the live OpenNeuroAtlas repository data."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.root_dir = REPO_ROOT
        cls.schema_path = cls.root_dir / "schemas" / "registry-schema.json"
        cls.schema, cls.schema_issues = load_and_check_schema(cls.schema_path)

    def test_schema_self_check(self) -> None:
        self.assertIsNotNone(self.schema, "schemas/registry-schema.json failed to load.")
        self.assertEqual(
            self.schema_issues,
            [],
            f"Schema validation errors:\n{_format_issues(self.schema_issues)}",
        )

    def test_datasets_collection_valid(self) -> None:
        assert self.schema is not None
        records, issues = validate_collection_file(
            self.root_dir / "data" / "datasets.json",
            "datasets",
            self.schema,
            check_min_counts=True,
        )
        self.assertGreaterEqual(len(records), MIN_RECORD_COUNTS["datasets"])
        self.assertEqual(issues, [], f"Dataset validation errors:\n{_format_issues(issues)}")

    def test_models_collection_valid(self) -> None:
        assert self.schema is not None
        records, issues = validate_collection_file(
            self.root_dir / "data" / "models.json",
            "models",
            self.schema,
            check_min_counts=True,
        )
        self.assertGreaterEqual(len(records), MIN_RECORD_COUNTS["models"])
        self.assertEqual(issues, [], f"Model validation errors:\n{_format_issues(issues)}")

    def test_challenges_collection_valid(self) -> None:
        assert self.schema is not None
        records, issues = validate_collection_file(
            self.root_dir / "data" / "challenges.json",
            "challenges",
            self.schema,
            check_min_counts=True,
        )
        self.assertGreaterEqual(len(records), MIN_RECORD_COUNTS["challenges"])
        self.assertEqual(issues, [], f"Challenge validation errors:\n{_format_issues(issues)}")

    def test_full_registry_cross_collection_integrity(self) -> None:
        report = validate_registry(self.root_dir, strict=True, check_urls=False, check_min_counts=True)
        for col, min_count in MIN_RECORD_COUNTS.items():
            self.assertGreaterEqual(
                report.counts.get(col, 0),
                min_count,
                f"Expected at least {min_count} records in {col}, got {report.counts.get(col, 0)}.",
            )
        self.assertTrue(
            report.passed,
            f"Full registry validation failed with {len(report.errors)} error(s):\n"
            f"{_format_issues(report.errors)}",
        )

    def test_no_cross_collection_duplicate_bibtex_keys(self) -> None:
        seen: dict[str, str] = {}
        duplicates: list[str] = []
        for col in COLLECTIONS:
            payload = json.loads((self.root_dir / "data" / f"{col}.json").read_text(encoding="utf-8"))
            for rec in payload.get("records", []):
                key = rec.get("citation", {}).get("bibtexKey", "")
                key_low = key.lower()
                loc = f"data/{col}.json:{rec.get('id')}"
                if key_low in seen:
                    duplicates.append(f"'{key}' in {loc} collides with {seen[key_low]}")
                else:
                    seen[key_low] = loc
        self.assertEqual(duplicates, [], f"Duplicate cross-collection bibtexKeys: {duplicates}")


class TestValidatorRules(unittest.TestCase):
    """Unit tests verifying that every schema and integrity rule catches malformed records."""

    @classmethod
    def setUpClass(cls) -> None:
        schema_path = REPO_ROOT / "schemas" / "registry-schema.json"
        cls.schema, issues = load_and_check_schema(schema_path)
        if cls.schema is None or issues:
            raise RuntimeError(f"Cannot run self-tests; schema invalid: {_format_issues(issues)}")

    @staticmethod
    def _sample_valid_dataset() -> dict[str, Any]:
        return {
            "id": "sample-upenn-gbm",
            "name": "Sample University of Pennsylvania Glioblastoma Cohort",
            "shortName": "Sample-GBM",
            "year": 2022,
            "pathologies": ["Glioma / GBM"],
            "modalities": ["Structural MRI", "Diffusion MRI / DTI"],
            "clinicalPhases": ["Pre-Op"],
            "tasks": ["Tumor Segmentation", "Survival / Outcome Prediction"],
            "cohortSize": 630,
            "cohortDisplay": "630 patients",
            "annotations": ["Voxel-wise Tumor Sub-regions", "Clinical Outcomes / Survival"],
            "molecularMarkers": ["IDH", "MGMT"],
            "accessTier": "Open Access",
            "license": "CC BY 4.0",
            "platform": "TCIA",
            "url": "https://www.cancerimagingarchive.net/collection/upenn-gbm/",
            "paperUrl": "https://doi.org/10.1038/s41597-022-01560-7",
            "citation": {
                "authors": "Bakas, Spyridon and Sako, Chiharu and others",
                "title": "The University of Pennsylvania glioblastoma cohort",
                "venue": "Scientific Data",
                "year": 2022,
                "bibtexKey": "bakas2022samplegbm",
                "doi": "10.1038/s41597-022-01560-7",
            },
            "fetchSnippet": "pip install tcia_utils && python -c \"print('download')\"",
            "highlights": "Multi-parametric glioma MRI cohort with clinical survival and molecular markers.",
            "limitations": "Single-center US cohort with heterogeneous scanner protocols.",
        }

    def test_valid_dataset_passes(self) -> None:
        assert self.schema is not None
        errs = validate_record(self._sample_valid_dataset(), "datasets", self.schema)
        self.assertEqual(errs, [])

    def test_rejects_bad_vocabulary_value(self) -> None:
        assert self.schema is not None
        rec = self._sample_valid_dataset()
        rec["modalities"] = ["Structural MRI", "Nonexistent Modality"]
        errs = validate_record(rec, "datasets", self.schema)
        self.assertTrue(any("modalities[1]" in path for path, _ in errs))

    def test_rejects_forbidden_url_substrings_and_non_https(self) -> None:
        assert self.schema is not None
        for bad_url in (
            "http://www.cancerimagingarchive.net/collection/upenn-gbm/",
            "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc123",
            "https://example.com/fake-dataset",
            "https://localhost/dataset",
        ):
            rec = self._sample_valid_dataset()
            rec["url"] = bad_url
            errs = validate_record(rec, "datasets", self.schema)
            self.assertTrue(
                any(path == "url" for path, _ in errs),
                f"Expected URL error for {bad_url}",
            )

    def test_rejects_invalid_cohort_size_and_bool_trap(self) -> None:
        assert self.schema is not None
        for bad_cohort in (-10, 0, True, False, 12.5, "630"):
            rec = self._sample_valid_dataset()
            rec["cohortSize"] = bad_cohort
            errs = validate_record(rec, "datasets", self.schema)
            self.assertTrue(
                any(path == "cohortSize" for path, _ in errs),
                f"Expected cohortSize error for {bad_cohort!r}",
            )

        rec_null = self._sample_valid_dataset()
        rec_null["cohortSize"] = None
        self.assertEqual(validate_record(rec_null, "datasets", self.schema), [])

    def test_rejects_out_of_range_year(self) -> None:
        assert self.schema is not None
        for bad_year in (2004, 2028):
            rec = self._sample_valid_dataset()
            rec["year"] = bad_year
            errs = validate_record(rec, "datasets", self.schema)
            self.assertTrue(any(path == "year" for path, _ in errs))

    def test_rejects_invalid_challenge_years_active(self) -> None:
        assert self.schema is not None
        base_challenge = {
            "id": "sample-challenge",
            "name": "Sample Neuro Benchmark",
            "organizer": "MICCAI Consortium",
            "yearsActive": "2022–2025",
            "status": "Active / Recurring",
            "modalities": ["Structural MRI"],
            "pathologies": ["Glioma / GBM"],
            "tasks": ["Tumor Segmentation"],
            "metrics": ["Dice"],
            "platform": "Synapse",
            "url": "https://www.synapse.org/Synapse:syn12345",
            "paperUrl": None,
            "citation": {
                "authors": "Doe, Jane",
                "title": "Sample Neuro Benchmark Summary",
                "venue": "MICCAI",
                "year": 2024,
                "bibtexKey": "doe2024samplechallenge",
                "doi": None,
            },
            "highlights": "Sample multi-institutional neuroimaging segmentation challenge for regression testing.",
        }
        self.assertEqual(validate_record(base_challenge, "challenges", self.schema), [])
        for bad_span in ("2024–2020", "2022–2030", "2004–2020"):
            rec = dict(base_challenge, yearsActive=bad_span)
            errs = validate_record(rec, "challenges", self.schema)
            self.assertTrue(
                any(path == "yearsActive" for path, _ in errs),
                f"Expected yearsActive error for {bad_span}",
            )

    def test_rejects_unknown_property_and_weights_mismatch(self) -> None:
        assert self.schema is not None
        rec = self._sample_valid_dataset()
        rec["unexpectedField"] = "should fail"
        errs = validate_record(rec, "datasets", self.schema)
        self.assertTrue(any(path == "unexpectedField" for path, _ in errs))

        bad_model = {
            "id": "sample-model",
            "name": "Sample Model",
            "category": "Foundation Model",
            "year": 2024,
            "modalities": ["Structural MRI"],
            "pathologies": ["Multi-Pathology"],
            "architecture": "3D Vision Transformer",
            "weightsAvailable": False,
            "openSourceLicense": "Apache-2.0",
            "framework": "PyTorch",
            "repoUrl": "https://github.com/openneuroatlas/sample-model",
            "weightsUrl": "https://huggingface.co/openneuroatlas/sample-model",
            "paperUrl": None,
            "citation": {
                "authors": "Doe, Jane",
                "title": "Sample Neuroimaging Foundation Model",
                "venue": "MICCAI",
                "year": 2024,
                "bibtexKey": "doe2024sample",
                "doi": None,
            },
            "installSnippet": "pip install sample-neuro-model",
            "highlights": "Pretrained 3D neuroimaging foundation backbone for multi-pathology segmentation.",
        }
        model_errs = validate_record(bad_model, "models", self.schema)
        self.assertTrue(any(path == "weightsAvailable" for path, _ in model_errs))

    def test_rejects_duplicate_ids_bibtex_and_min_count_violations(self) -> None:
        assert self.schema is not None
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_root = Path(tmp_dir)
            (tmp_root / "schemas").mkdir()
            (tmp_root / "data").mkdir()
            (tmp_root / "schemas" / "registry-schema.json").write_text(
                (REPO_ROOT / "schemas" / "registry-schema.json").read_text(encoding="utf-8"),
                encoding="utf-8",
            )

            ds1 = self._sample_valid_dataset()
            ds2 = self._sample_valid_dataset()
            # Trigger both duplicate ID and case-insensitive duplicate bibtexKey
            ds2["citation"] = dict(ds1["citation"], bibtexKey="BAKAS2022SAMPLEGBM")

            (tmp_root / "data" / "datasets.json").write_text(
                json.dumps(
                    {
                        "schemaVersion": self.schema["schemaVersion"],
                        "recordType": "datasets",
                        "lastUpdated": "2026-11-19",
                        "records": [ds1, ds2],
                    }
                ),
                encoding="utf-8",
            )
            # Model sharing same ID as dataset to trigger global duplicate ID check
            colliding_model = {
                "id": ds1["id"],
                "name": "Colliding Model",
                "category": "Foundation Model",
                "year": 2024,
                "modalities": ["Structural MRI"],
                "pathologies": ["Multi-Pathology"],
                "architecture": "3D Vision Transformer",
                "weightsAvailable": True,
                "openSourceLicense": "Apache-2.0",
                "framework": "PyTorch",
                "repoUrl": "https://github.com/openneuroatlas/colliding-model",
                "weightsUrl": None,
                "paperUrl": None,
                "citation": {
                    "authors": "Doe, Jane",
                    "title": "Sample Colliding Model for Validation Testing",
                    "venue": "MICCAI",
                    "year": 2024,
                    "bibtexKey": "doe2024colliding",
                    "doi": None,
                },
                "installSnippet": "pip install colliding-model",
                "highlights": "Pretrained 3D neuroimaging foundation model used to verify global unique ID checks.",
            }
            (tmp_root / "data" / "models.json").write_text(
                json.dumps(
                    {
                        "schemaVersion": self.schema["schemaVersion"],
                        "recordType": "models",
                        "lastUpdated": "2026-11-19",
                        "records": [colliding_model],
                    }
                ),
                encoding="utf-8",
            )
            (tmp_root / "data" / "challenges.json").write_text(
                json.dumps(
                    {
                        "schemaVersion": self.schema["schemaVersion"],
                        "recordType": "challenges",
                        "lastUpdated": "2026-11-19",
                        "records": [],
                    }
                ),
                encoding="utf-8",
            )

            report = validate_registry(tmp_root, strict=True, check_min_counts=True)
            self.assertFalse(report.passed)
            error_texts = [e.format() for e in report.errors]
            self.assertTrue(any("Duplicate id" in t for t in error_texts))
            self.assertTrue(any("Duplicate bibtexKey" in t for t in error_texts))
            self.assertTrue(any("Globally duplicate id" in t for t in error_texts))
            self.assertTrue(any("below minimum required count" in t for t in error_texts))


# =============================================================================
# CLI Entrypoint
# =============================================================================


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate OpenNeuroAtlas registry JSON collections against schemas/registry-schema.json."
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=REPO_ROOT,
        help="Repository root directory (default: auto-detected from script location).",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Strict CI mode (escalates live URL check failures to errors).",
    )
    parser.add_argument(
        "--check-urls",
        action="store_true",
        help="Perform polite live HTTP HEAD/GET verification on all record URLs (opt-in; off by default).",
    )
    parser.add_argument(
        "--skip-min-counts",
        action="store_true",
        help="Skip minimum collection size thresholds (useful when testing partial fixture sets).",
    )
    parser.add_argument(
        "--unittest",
        action="store_true",
        help="Run the embedded Python unittest suite instead of the summary CLI report.",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress summary output on pass; print only errors and warnings.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    if args.unittest:
        suite = unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__])
        runner = unittest.TextTestRunner(verbosity=2)
        result = runner.run(suite)
        return 0 if result.wasSuccessful() else 1

    report = validate_registry(
        root_dir=args.root.resolve(),
        strict=args.strict,
        check_urls=args.check_urls,
        check_min_counts=not args.skip_min_counts,
    )

    if not args.quiet:
        print("OpenNeuroAtlas Registry Validation Summary")
        print("==========================================")
        for col in COLLECTIONS:
            count = report.counts.get(col, 0)
            min_req = MIN_RECORD_COUNTS[col]
            status = "OK" if count >= min_req else f"BELOW MIN ({min_req})"
            print(f"  data/{col}.json : {count:3d} records  [{status}]")
        print(f"  Errors   : {len(report.errors)}")
        print(f"  Warnings : {len(report.warnings)}")

    for warn in report.warnings:
        print(warn.format(), file=sys.stderr)
    for err in report.errors:
        print(err.format(), file=sys.stderr)

    if report.passed:
        if not args.quiet:
            print("[PASS] All schema, vocabulary, URL, and cross-record integrity checks succeeded.")
        return 0

    print(
        f"[FAIL] Registry validation failed with {len(report.errors)} error(s).",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
