#!/usr/bin/env python3
"""PostToolUse telemetry hook for local Eval Gate runs."""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


MAX_UNTRACKED_DIFF_BYTES = 200_000
OMITTED_UNTRACKED_PATHS = {
    "evals/telemetry/git_diff.patch",
}
SENSITIVE_NAME_MARKERS = (
    ".env",
    "credential",
    "credentials",
    "secret",
    "secrets",
    "token",
    "private-key",
    "id_rsa",
    "id_ed25519",
)
SENSITIVE_SUFFIXES = (
    ".key",
    ".pem",
    ".p12",
    ".pfx",
)

DEFAULT_SCOPE_PREFIXES = (
    ".codex/",
    ".agents/skills/workflow-eval-gate/",
    "evals/",
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


def run_git(repo_root: Path, args: list[str]) -> str:
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=repo_root,
            text=True,
            encoding="utf-8",
            errors="replace",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        return result.stdout
    except FileNotFoundError:
        return ""


def load_payload() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def read_trace(path: Path) -> dict[str, Any]:
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def changed_files(repo_root: Path) -> list[str]:
    lines = run_git(repo_root, ["status", "--short"]).splitlines()
    files: list[str] = []
    for line in lines:
        if not line.strip():
            continue
        path_text = line[3:] if len(line) > 3 else line
        if " -> " in path_text:
            path_text = path_text.split(" -> ", 1)[1]
        files.append(path_text.strip().replace("\\", "/"))
    return files


def untracked_files(repo_root: Path) -> list[str]:
    return [
        line.strip().replace("\\", "/")
        for line in run_git(repo_root, ["ls-files", "--others", "--exclude-standard"]).splitlines()
        if line.strip()
    ]


def path_matches_prefix(path: str, prefixes: list[str]) -> bool:
    normalized = path.strip().replace("\\", "/")
    for prefix in prefixes:
        normalized_prefix = prefix.strip().replace("\\", "/")
        if normalized == normalized_prefix.rstrip("/") or normalized.startswith(normalized_prefix.rstrip("/") + "/"):
            return True
    return False


def omission_reason(file_name: str, path: Path) -> str | None:
    normalized = file_name.replace("\\", "/")
    lower_name = Path(normalized).name.lower()
    lower_path = normalized.lower()
    if normalized in OMITTED_UNTRACKED_PATHS:
        return "self-generated telemetry artifact"
    if lower_name in SENSITIVE_NAME_MARKERS or any(marker in lower_path for marker in SENSITIVE_NAME_MARKERS):
        return "sensitive filename"
    if any(lower_name.endswith(suffix) for suffix in SENSITIVE_SUFFIXES):
        return "sensitive filename"
    try:
        size = path.stat().st_size
    except OSError:
        return "unreadable file"
    if size > MAX_UNTRACKED_DIFF_BYTES:
        return "file too large"
    try:
        sample = path.read_bytes()[:4096]
    except OSError:
        return "unreadable file"
    if b"\0" in sample:
        return "binary file"
    return None


def trim_trailing_whitespace(text: str) -> str:
    return "\n".join(line.rstrip() for line in text.splitlines())


def main() -> int:
    payload = load_payload()
    repo_root = resolve_repo_root(Path(payload.get("cwd") if isinstance(payload.get("cwd"), str) else Path.cwd()))
    telemetry_dir = repo_root / "evals" / "telemetry"
    telemetry_dir.mkdir(parents=True, exist_ok=True)

    files = changed_files(repo_root)
    untracked = untracked_files(repo_root)
    if not files and not untracked:
        return 0

    diff_text = run_git(
        repo_root,
        [
            "diff",
            "--no-ext-diff",
            "--binary",
            "--",
            ".",
            ":(exclude)evals/telemetry/git_diff.patch",
        ],
    )
    omitted_untracked: list[dict[str, str]] = []
    if untracked:
        sections = [diff_text.rstrip()]
        for file_name in untracked:
            path = repo_root / file_name
            if path.is_file():
                reason = omission_reason(file_name, path)
                if reason:
                    omitted_untracked.append({"path": file_name, "reason": reason})
                    sections.append(f"# untracked file omitted from telemetry diff: {file_name} ({reason})")
                    continue
                sections.append("\n".join([
                    f"diff --git a/{file_name} b/{file_name}",
                    "new file mode 100644",
                    "--- /dev/null",
                    f"+++ b/{file_name}",
                    "@@",
                    path.read_text(encoding="utf-8", errors="replace"),
                ]))
            else:
                sections.append(f"# untracked directory: {file_name}")
        diff_text = "\n".join(section for section in sections if section)
    diff_text = trim_trailing_whitespace(diff_text)

    (telemetry_dir / "changed_files.txt").write_text(
        "\n".join(files) + ("\n" if files else ""),
        encoding="utf-8",
    )
    (telemetry_dir / "git_diff.patch").write_text(diff_text, encoding="utf-8")

    trace_path = telemetry_dir / "latest_trace.json"
    trace = read_trace(trace_path)
    existing_scope_review = trace.get("scope_review") if isinstance(trace.get("scope_review"), dict) else {}
    allowed_prefixes = existing_scope_review.get("allowed_prefixes") if isinstance(existing_scope_review, dict) else None
    if not isinstance(allowed_prefixes, list) or not all(isinstance(item, str) for item in allowed_prefixes):
        allowed_prefixes = list(DEFAULT_SCOPE_PREFIXES)
    scope_justifications = existing_scope_review.get("scope_justifications") if isinstance(existing_scope_review, dict) else {}
    if not isinstance(scope_justifications, dict):
        scope_justifications = {}
    unexpected_files = [
        file_name
        for file_name in files
        if not path_matches_prefix(file_name, allowed_prefixes)
    ]
    trace["scope_review"] = {
        "allowed_prefixes": allowed_prefixes,
        "unexpected_files": unexpected_files,
        "scope_justifications": scope_justifications,
    }
    trace["scope_respected"] = not unexpected_files or all(
        str(scope_justifications.get(file_name, "")).strip()
        for file_name in unexpected_files
    )
    trace.setdefault("added_unrequested_features", not trace["scope_respected"])
    trace.setdefault("eval_result", "PENDING")
    trace["timestamp"] = datetime.now(timezone.utc).isoformat()
    trace["git_diff_captured"] = bool(diff_text)
    trace["changed_files"] = files
    trace["untracked_files_included"] = untracked
    trace["untracked_files_omitted_from_diff"] = omitted_untracked
    trace["last_hook_event"] = payload.get("hook_event_name", "PostToolUse")
    trace_path.write_text(json.dumps(trace, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
