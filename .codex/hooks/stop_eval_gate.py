#!/usr/bin/env python3
"""Stop hook that runs the local Eval Gate."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any


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


def load_payload() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def main() -> int:
    payload = load_payload()
    repo_root = resolve_repo_root(Path(payload.get("cwd") if isinstance(payload.get("cwd"), str) else Path.cwd()))
    runner = repo_root / ".agents" / "skills" / "workflow-eval-gate" / "scripts" / "run_eval.py"
    if not runner.exists():
        print(json.dumps({
            "continue": False,
            "stopReason": f"Eval Gate runner not found: {runner}",
        }))
        return 1

    result = subprocess.run(
        [sys.executable, str(runner)],
        cwd=repo_root,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    eval_output = "\n".join(part for part in [result.stdout.strip(), result.stderr.strip()] if part)
    payload = {
        "continue": result.returncode == 0,
        "systemMessage": eval_output or "Eval Gate finished with no output.",
    }
    if result.returncode != 0:
        payload["stopReason"] = eval_output or "Eval Gate failed."
    print(json.dumps(payload))
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
