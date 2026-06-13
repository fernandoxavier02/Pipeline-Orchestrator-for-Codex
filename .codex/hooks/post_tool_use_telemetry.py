#!/usr/bin/env python3
"""PostToolUse telemetry hook for local Eval Gate runs."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


sys.dont_write_bytecode = True

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
    ".pipeline/sessions/",
    "docs/pipeline-orchestrator-codex/11-eval-gate-plan.md",
    "docs/pipeline-orchestrator-codex/README.md",
    "AGENTS.md",
    "PROJECT_CONTEXT.md",
    "README.md",
    ".kiro/",
)
PIPELINE_AGENT_FQN_RE = re.compile(r"PIPELINE_AGENT_FQN:\s*([A-Za-z0-9:_-]+)")
READ_ONLY_COMMAND_RE = re.compile(
    r"^\s*(?:"
    r"git\s+(?:status|diff|show|log|rev-parse|ls-files)\b"
    r"|rg\b"
    r"|grep\b"
    r"|findstr\b"
    r"|Get-Content\b"
    r"|Get-ChildItem\b"
    r"|Select-String\b"
    r"|Test-Path\b"
    r"|Resolve-Path\b"
    r"|python(?:3)?\s+\.agents/skills/workflow-eval-gate/scripts/run_eval\.py\b"
    r")",
    re.IGNORECASE,
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


def env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


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


def git_ref(repo_root: Path, *args: str) -> str | None:
    value = run_git(repo_root, list(args)).strip()
    return value or None


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


def merge_allowed_prefixes(existing: Any) -> list[str]:
    prefixes: list[str] = []
    if isinstance(existing, list):
        prefixes.extend(str(item) for item in existing if isinstance(item, str) and item.strip())
    for prefix in DEFAULT_SCOPE_PREFIXES:
        if prefix not in prefixes:
            prefixes.append(prefix)
    return prefixes


def payload_text(payload: dict[str, Any]) -> str:
    parts: list[str] = []
    for key in ("command", "tool_name", "pipeline_agent_fqn", "session_id"):
        value = payload.get(key)
        if isinstance(value, str):
            parts.append(value)
    tool_input = payload.get("tool_input")
    if isinstance(tool_input, dict):
        for key in ("command", "cmd", "prompt", "message"):
            value = tool_input.get(key)
            if isinstance(value, str):
                parts.append(value)
    return "\n".join(parts)


def payload_command(payload: dict[str, Any]) -> str:
    value = payload.get("command")
    if isinstance(value, str):
        return value
    tool_input = payload.get("tool_input")
    if isinstance(tool_input, dict):
        for key in ("command", "cmd"):
            value = tool_input.get(key)
            if isinstance(value, str):
                return value
    return ""


def is_read_only_payload(payload: dict[str, Any]) -> bool:
    tool_name = str(payload.get("tool_name", ""))
    if tool_name in {"Read", "Glob", "Grep", "LS"}:
        return True
    command = payload_command(payload)
    return bool(command and READ_ONLY_COMMAND_RE.search(command))


def resolve_pipeline_agent_fqn(payload: dict[str, Any], observed_text: str, existing: Any) -> str | None:
    value = payload.get("pipeline_agent_fqn")
    if isinstance(value, str) and value.strip():
        return value.strip()

    match = PIPELINE_AGENT_FQN_RE.search(observed_text)
    if match:
        return match.group(1)

    if isinstance(existing, dict):
        value = existing.get("pipeline_agent_fqn")
        if isinstance(value, str) and value.strip():
            return value.strip()

    return None


def merge_plugin_execution(trace: dict[str, Any], payload: dict[str, Any], observed_text: str) -> dict[str, Any]:
    existing = trace.get("plugin_execution")
    existing = existing if isinstance(existing, dict) else {}
    existing_runtime = existing.get("real_agent_runtime")
    existing_runtime = existing_runtime if isinstance(existing_runtime, dict) else {}

    tool_name = payload.get("tool_name")
    pipeline_agent_fqn = resolve_pipeline_agent_fqn(payload, observed_text, existing)
    observed = (
        existing.get("observed") is True
        or "pipeline-orchestrator-for-codex:pipeline" in observed_text
        or bool(pipeline_agent_fqn)
    )

    return {
        "observed": observed,
        "status": existing.get("status", "observed" if observed else "not-observed"),
        "pipeline_agent_fqn": pipeline_agent_fqn,
        "real_agent_runtime": {
            "spawn_agent_observed": existing_runtime.get("spawn_agent_observed") is True or tool_name == "spawn_agent",
            "wait_agent_observed": existing_runtime.get("wait_agent_observed") is True or tool_name == "wait_agent",
        },
    }


def main() -> int:
    payload = load_payload()
    repo_root = resolve_repo_root(Path(payload.get("cwd") if isinstance(payload.get("cwd"), str) else Path.cwd()))
    telemetry_dir = repo_root / "evals" / "telemetry"

    files = changed_files(repo_root)
    untracked = untracked_files(repo_root)
    has_git_changes = bool(files or untracked)

    diff_text = ""
    omitted_untracked: list[dict[str, str]] = []
    if has_git_changes:
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

    trace_path = telemetry_dir / "latest_trace.json"
    trace = read_trace(trace_path)
    existing_scope_review = trace.get("scope_review") if isinstance(trace.get("scope_review"), dict) else {}
    allowed_prefixes = existing_scope_review.get("allowed_prefixes") if isinstance(existing_scope_review, dict) else None
    allowed_prefixes = merge_allowed_prefixes(allowed_prefixes)
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
    trace["added_unrequested_features"] = not trace["scope_respected"]
    trace.setdefault("eval_result", "PENDING")
    observed_text = payload_text(payload)
    trace["execution_observed"] = True
    trace["execution_event"] = payload.get("hook_event_name", "PostToolUse")
    trace["execution_identity"] = {
        "hook_event": payload.get("hook_event_name", "PostToolUse"),
        "session_id": payload.get("session_id"),
        "tool_name": payload.get("tool_name"),
    }
    trace["plugin_execution"] = merge_plugin_execution(trace, payload, observed_text)
    trace["git_state"] = "dirty" if has_git_changes else "clean"
    trace["timestamp"] = datetime.now(timezone.utc).isoformat()
    trace["git_diff_captured"] = bool(diff_text)
    trace["changed_files"] = files
    trace["untracked_files_included"] = untracked
    trace["untracked_files_omitted_from_diff"] = omitted_untracked
    trace["last_hook_event"] = payload.get("hook_event_name", "PostToolUse")
    trace["validated_target"] = {
        "ref": "HEAD+working-tree" if has_git_changes else "HEAD",
        "base_commit": git_ref(repo_root, "rev-parse", "HEAD"),
        "changed_files": files,
        "diff_command": "git diff --no-ext-diff --binary -- . :(exclude)evals/telemetry/git_diff.patch",
    }

    if env_flag("EVAL_GATE_READ_ONLY") or is_read_only_payload(payload):
        sys.stdout.write(json.dumps(trace, indent=2, sort_keys=True) + "\n")
        return 0

    telemetry_dir.mkdir(parents=True, exist_ok=True)
    (telemetry_dir / "changed_files.txt").write_text(
        "\n".join(files) + ("\n" if files else ""),
        encoding="utf-8",
    )
    (telemetry_dir / "git_diff.patch").write_text(diff_text, encoding="utf-8")
    trace_path.write_text(json.dumps(trace, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
