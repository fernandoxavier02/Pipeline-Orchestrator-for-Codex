#!/usr/bin/env python3
"""Deterministic local Eval Gate for Pipeline Orchestrator workflow changes."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Iterable


REQUIRED_REPORT_SECTIONS = [
    "What was inspected",
    "What was changed",
    "What was not changed",
    "Eval result",
    "Remaining risks",
    "Next safest step",
]

FORBIDDEN_PATH_PREFIXES = (
    "node_modules/",
    ".git/",
    "dist/",
    "build/",
)

SUCCESS_CLAIMS = (
    "success",
    "successful",
    "succeeded",
    "passed",
    "passou",
    "sucesso",
    "concluido",
    "concluído",
    "pronto",
)

EVAL_EVIDENCE_MARKERS = (
    "eval result: pass",
    "eval runner passed",
)

REQUIRED_VALIDATION_COMMANDS = (
    ("npm run lint:types",),
    ("npm run build",),
    ("npm test",),
    (
        "python -m unittest evals.tests.test_hooks_config evals.tests.test_policy_hook evals.tests.test_telemetry_hook evals.tests.test_eval_gate evals.tests.test_hook_trust_docs",
        "python3 -m unittest evals.tests.test_hooks_config evals.tests.test_policy_hook evals.tests.test_telemetry_hook evals.tests.test_eval_gate evals.tests.test_hook_trust_docs",
    ),
    (
        "python .agents/skills/workflow-eval-gate/scripts/run_eval.py",
        "python3 .agents/skills/workflow-eval-gate/scripts/run_eval.py",
    ),
    ("git diff --check",),
)

DEFAULT_SCOPE_PREFIXES = (
    ".codex/",
    ".agents/skills/workflow-eval-gate/",
    "evals/",
    ".pipeline/sessions/",
    "docs/pipeline-orchestrator-codex/11-eval-gate-plan.md",
    "docs/pipeline-orchestrator-codex/README.md",
    "AGENTS.md",
    "PROJECT_CONTEXT.md",
    "README.md",
    ".kiro/",
)


def resolve_repo_root(start: Path) -> Path:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=start,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )
        return Path(result.stdout.strip()).resolve()
    except (subprocess.CalledProcessError, FileNotFoundError):
        current = start.resolve()
        for candidate in [current, *current.parents]:
            if (candidate / ".git").exists():
                return candidate
        return current


def normalize_path(raw: str) -> str:
    normalized = raw.strip().replace("\\", "/")
    while normalized.startswith("./"):
        normalized = normalized[2:]
    return normalized


def load_changed_files(path: Path) -> list[str]:
    if not path.exists():
        return []
    return [
        normalize_path(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if normalize_path(line)
    ]


def load_behavior_cases(path: Path) -> tuple[int, list[str]]:
    errors: list[str] = []
    if not path.exists():
        return 0, ["missing evals/cases/orchestrator_behavior.yaml"]

    raw_lines = path.read_text(encoding="utf-8").splitlines()
    lines = [
        line.rstrip()
        for line in raw_lines
        if line.strip() and not line.lstrip().startswith("#")
    ]
    if not lines:
        return 0, ["behavior cases file is empty"]
    if lines[0] != "scenarios:":
        return 0, ["behavior cases root must be exactly: scenarios:"]

    scenarios: list[dict[str, object]] = []
    current: dict[str, object] | None = None
    in_then = False
    for line_number, line in enumerate(lines[1:], start=2):
        if line.startswith("  - name: "):
            name = line.split(":", 1)[1].strip()
            if not name:
                errors.append(f"behavior case at line {line_number} has empty name")
            current = {"name": name, "fields": set(), "then_items": 0}
            scenarios.append(current)
            in_then = False
            continue

        if current is None:
            errors.append(f"behavior case content before first scenario at line {line_number}")
            continue

        if line.startswith("    given: "):
            value = line.split(":", 1)[1].strip()
            if not value:
                errors.append(f"behavior case {current['name']} has empty given")
            current["fields"].add("given")  # type: ignore[union-attr]
            in_then = False
            continue

        if line.startswith("    when: "):
            value = line.split(":", 1)[1].strip()
            if not value:
                errors.append(f"behavior case {current['name']} has empty when")
            current["fields"].add("when")  # type: ignore[union-attr]
            in_then = False
            continue

        if line == "    then:":
            current["fields"].add("then")  # type: ignore[union-attr]
            in_then = True
            continue

        if in_then and line.startswith("      - "):
            value = line[8:].strip()
            if not value:
                errors.append(f"behavior case {current['name']} has empty then item")
            current["then_items"] = int(current["then_items"]) + 1
            continue

        errors.append(f"unsupported or malformed behavior case syntax at line {line_number}: {line}")

    if not scenarios:
        errors.append("behavior cases must include at least one scenario")
    for scenario in scenarios:
        fields = scenario["fields"]
        for field in ("given", "when", "then"):
            if field not in fields:
                errors.append(f"behavior case {scenario['name']} missing {field} field")
        if int(scenario["then_items"]) == 0:
            errors.append(f"behavior case {scenario['name']} must include at least one then item")
    return len(scenarios), errors


def has_required_sections(report_text: str) -> list[str]:
    lower = report_text.lower()
    missing = []
    for section in REQUIRED_REPORT_SECTIONS:
        if f"## {section}".lower() not in lower and f"# {section}".lower() not in lower:
            missing.append(section)
    return missing


def final_report_claims_success(report_text: str) -> bool:
    lower = report_text.lower()
    return any(claim in lower for claim in SUCCESS_CLAIMS)


def final_report_has_eval_evidence(report_text: str) -> bool:
    lower = report_text.lower()
    eval_section_match = re.search(
        r"^#{1,6}\s+eval result\s*$([\s\S]*?)(?=^#{1,6}\s+|\Z)",
        lower,
        flags=re.MULTILINE,
    )
    if not eval_section_match:
        return False
    eval_section = eval_section_match.group(1)
    return any(marker in eval_section for marker in EVAL_EVIDENCE_MARKERS)


def forbidden_changed_paths(changed_files: Iterable[str]) -> list[str]:
    forbidden = []
    for changed_file in changed_files:
        normalized = normalize_path(changed_file)
        if any(normalized == prefix.rstrip("/") or normalized.startswith(prefix) for prefix in FORBIDDEN_PATH_PREFIXES):
            forbidden.append(changed_file)
    return forbidden


def path_matches_prefix(path: str, prefixes: Iterable[str]) -> bool:
    normalized = normalize_path(path)
    for prefix in prefixes:
        normalized_prefix = normalize_path(prefix)
        if normalized == normalized_prefix.rstrip("/") or normalized.startswith(normalized_prefix.rstrip("/") + "/"):
            return True
    return False


def missing_scope_justifications(scope_review: object) -> list[str]:
    if not isinstance(scope_review, dict):
        return ["missing telemetry scope_review"]

    unexpected = scope_review.get("unexpected_files")
    justifications = scope_review.get("scope_justifications")
    if not isinstance(unexpected, list):
        return ["telemetry scope_review.unexpected_files must be a list"]
    if not isinstance(justifications, dict):
        justifications = {}

    missing = []
    for item in unexpected:
        if not isinstance(item, str):
            missing.append("telemetry scope_review.unexpected_files must contain only strings")
            continue
        if not str(justifications.get(item, "")).strip():
            missing.append(f"missing scope justification for unexpected file: {item}")
    return missing


def validate_command_evidence(telemetry: dict[str, object]) -> list[str]:
    validation_evidence = telemetry.get("validation_evidence")
    if not isinstance(validation_evidence, dict):
        return ["missing telemetry validation_evidence"]

    errors = []
    commands = validation_evidence.get("commands")
    if not isinstance(commands, dict):
        return ["telemetry validation_evidence.commands must be an object"]

    for command_options in REQUIRED_VALIDATION_COMMANDS:
        command = command_options[0]
        evidence = next((commands.get(option) for option in command_options if isinstance(commands.get(option), dict)), None)
        if not isinstance(evidence, dict):
            errors.append(f"missing validation evidence for command: {' or '.join(command_options)}")
            continue
        allowed_statuses = {"PASS"}
        if "npm test" in command_options:
            allowed_statuses.add("PASS_FOCUSED_AFTER_TIMEOUT")
        if evidence.get("status") not in allowed_statuses:
            errors.append(f"validation command did not pass: {' or '.join(command_options)}")
        if evidence.get("status") == "PASS_FOCUSED_AFTER_TIMEOUT" and not str(evidence.get("focused_evidence", "")).strip():
            errors.append(f"validation command needs focused evidence after timeout: {' or '.join(command_options)}")
    return errors


def validate(repo_root: Path) -> list[str]:
    errors: list[str] = []
    output_path = repo_root / "evals" / "outputs" / "latest_output.md"
    cases_path = repo_root / "evals" / "cases" / "orchestrator_behavior.yaml"
    trace_path = repo_root / "evals" / "telemetry" / "latest_trace.json"
    changed_files_path = repo_root / "evals" / "telemetry" / "changed_files.txt"
    diff_path = repo_root / "evals" / "telemetry" / "git_diff.patch"

    if not output_path.exists():
        errors.append("missing evals/outputs/latest_output.md")
        report_text = ""
    else:
        report_text = output_path.read_text(encoding="utf-8")
        for section in has_required_sections(report_text):
            errors.append(f"missing final report section: {section}")

    scenario_count, case_errors = load_behavior_cases(cases_path)
    errors.extend(case_errors)
    if scenario_count and f"behavior_cases: {scenario_count}" not in report_text:
        errors.append(f"final report must mention behavior_cases: {scenario_count}")

    if not trace_path.exists():
        errors.append("missing evals/telemetry/latest_trace.json")
        telemetry = None
    else:
        try:
            telemetry = json.loads(trace_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            errors.append(f"invalid JSON in evals/telemetry/latest_trace.json: {error}")
            telemetry = None

    if isinstance(telemetry, dict):
        if telemetry.get("scope_respected") is not True:
            errors.append("telemetry scope_respected must be true")
        if telemetry.get("added_unrequested_features") is True:
            errors.append("telemetry added_unrequested_features must not be true")
        errors.extend(missing_scope_justifications(telemetry.get("scope_review")))
        errors.extend(validate_command_evidence(telemetry))
    elif telemetry is not None:
        errors.append("evals/telemetry/latest_trace.json must contain a JSON object")

    execution_observed = isinstance(telemetry, dict) and telemetry.get("execution_observed") is True
    if isinstance(telemetry, dict) and not execution_observed:
        errors.append("telemetry execution_observed must be true")
    if execution_observed:
        execution_identity = telemetry.get("execution_identity")
        if not isinstance(execution_identity, dict):
            errors.append("telemetry execution_identity must be an object when execution_observed=true")
        elif not str(execution_identity.get("hook_event", "")).strip():
            errors.append("telemetry execution_identity.hook_event is required when execution_observed=true")

    if not changed_files_path.exists():
        errors.append("missing evals/telemetry/changed_files.txt")
    changed_files = load_changed_files(changed_files_path)
    if changed_files_path.exists() and not changed_files and not execution_observed:
        errors.append("evals/telemetry/changed_files.txt must not be empty without execution_observed=true")
    for changed_file in forbidden_changed_paths(changed_files):
        errors.append(f"forbidden changed path: {changed_file}")

    if isinstance(telemetry, dict):
        scope_review = telemetry.get("scope_review")
        if isinstance(scope_review, dict):
            prefixes = scope_review.get("allowed_prefixes")
            allowed_prefixes = prefixes if isinstance(prefixes, list) else list(DEFAULT_SCOPE_PREFIXES)
            expected_unexpected = [
                changed_file
                for changed_file in changed_files
                if not path_matches_prefix(changed_file, [str(prefix) for prefix in allowed_prefixes])
            ]
            reported_unexpected = scope_review.get("unexpected_files")
            if isinstance(reported_unexpected, list):
                normalized_reported = sorted(normalize_path(str(item)) for item in reported_unexpected)
                if sorted(expected_unexpected) != normalized_reported:
                    errors.append("telemetry scope_review.unexpected_files must match changed_files outside allowed_prefixes")

    if not diff_path.exists():
        errors.append("missing evals/telemetry/git_diff.patch")
    else:
        diff_text = diff_path.read_text(encoding="utf-8", errors="replace")
        if re.search(r"^diff --git a/evals/telemetry/git_diff\.patch b/evals/telemetry/git_diff\.patch$", diff_text, flags=re.MULTILINE):
            errors.append("evals/telemetry/git_diff.patch must not include itself")

    if final_report_claims_success(report_text) and not final_report_has_eval_evidence(report_text):
        errors.append("final report claims success without eval evidence")

    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the local Pipeline Orchestrator Eval Gate.")
    parser.add_argument("--repo-root", default=None, help="Repository root override for tests.")
    args = parser.parse_args(argv)

    repo_root = Path(args.repo_root).resolve() if args.repo_root else resolve_repo_root(Path.cwd())
    errors = validate(repo_root)

    if errors:
        print("EVAL RESULT: FAIL")
        for error in errors:
            print(f"- {error}")
        return 1

    print("EVAL RESULT: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
