#!/usr/bin/env python3
"""PreToolUse policy hook for local Eval Gate runs."""

from __future__ import annotations

import json
import re
import sys
from typing import Any


BLOCKED_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("rm -rf", re.compile(r"\brm\s+-rf\b", re.IGNORECASE)),
    ("git reset --hard", re.compile(r"\bgit\s+reset\s+--hard\b", re.IGNORECASE)),
    ("git clean -f -d", re.compile(r"\bgit\s+clean\b(?=[^\n\r;|]*\s-[A-Za-z]*f)(?=[^\n\r;|]*\s-[A-Za-z]*d)", re.IGNORECASE)),
    ("npm install", re.compile(r"\bnpm\s+install\b", re.IGNORECASE)),
    ("pnpm add", re.compile(r"\bpnpm\s+add\b", re.IGNORECASE)),
    ("yarn add", re.compile(r"\byarn\s+add\b", re.IGNORECASE)),
    ("pip install", re.compile(r"\bpip(?:3(?:\.\d+)?)?\s+install\b", re.IGNORECASE)),
    ("curl | shell", re.compile(r"\b(?:curl|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b.*\|\s*(?:sh|bash|powershell(?:\.exe)?|pwsh(?:\.exe)?)\b", re.IGNORECASE)),
    ("Invoke-Expression", re.compile(r"\bInvoke-Expression\b|\biex\b", re.IGNORECASE)),
    (
        "Remove-Item -Recurse -Force protected path",
        re.compile(
            r"\b(?:Remove-Item|rm|ri)\b(?=[^\n\r;|]*-(?:Recurse|r)\b)(?=[^\n\r;|]*-(?:Force|fo)\b)"
            r"[^\n\r;|]*(?:\.git|node_modules|dist|build)(?:[\\/\s]|$)",
            re.IGNORECASE,
        ),
    ),
    (
        "rmdir /s protected path",
        re.compile(r"\brmdir\b(?=[^\n\r;|]*/s\b)[^\n\r;|]*(?:\.git|node_modules|dist|build)(?:[\\/\s]|$)", re.IGNORECASE),
    ),
    (
        "del /s protected path",
        re.compile(r"\bdel\b(?=[^\n\r;|]*/s\b)[^\n\r;|]*(?:\.git|node_modules|dist|build)(?:[\\/\s]|$)", re.IGNORECASE),
    ),
)


def load_payload() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def extract_command(payload: dict[str, Any]) -> str:
    tool_input = payload.get("tool_input")
    if isinstance(tool_input, dict):
        command = tool_input.get("command")
        if isinstance(command, str):
            return command
    command = payload.get("command")
    return command if isinstance(command, str) else ""


def deny(reason: str) -> None:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        },
    }))


def main() -> int:
    payload = load_payload()
    command = extract_command(payload)
    for label, pattern in BLOCKED_PATTERNS:
        if pattern.search(command):
            deny(f"Eval Gate blocked dangerous command pattern: {label}")
            return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
