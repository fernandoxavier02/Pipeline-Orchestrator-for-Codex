# Batch 3 — Implementer (edit-guard escape route + pipeline-reset)

**Date:** 2026-07-03
**Status:** COMPLETE — all tests GREEN, lint clean.
**Approach:** REDO with new design (reverted verb-resolver NOT reused; write-verbs kept match-anywhere).

## Files touched (within CHANGE_CONTRACT)

- `hooks/edit-guard-hook.cjs` (modified) — anti-chaining tokenizer, escape-script allowlist, surgical write-detection fixes, read-only `.codex/pipeline` allow, deny hints.
- `tests/unit/hooks/edit-guard-hook.test.ts` (modified) — F1–F7 + anti-regression + escape-route tests.
- `scripts/pipeline-reset.cjs` (new) — deterministic reset escape route.
- `tests/unit/security/pipeline-reset.test.ts` (new).

Diff: 750 insertions / 35 deletions across the 4 files — within the +20% band (650×1.2=780). No files outside the contract were touched.

## Design (converged, no relitigation)

**Anti-chaining tokenizer (shared `tokenizeSegments`)** splits on `&&`, `||`, `;`, `|`, lone `&`, backtick, and the `$(` opener. It deliberately does NOT split on a bare `)` — that appears in ordinary interpreter code (`node -e "fs.rmSync(x)"`) and splitting there separated the interpreter keyword from the call.

**Escape-script allowlist** (`classifyEscapeCommand`): a command is EXEMPT only if it is exactly ONE segment (F1) with NO trailing redirection (F7) and is `node <script>` resolving (cwd → PLUGIN_ROOT → CODEX_PLUGIN_ROOT → CLAUDE_PLUGIN_ROOT, mirroring dispatch-guard) to one of:
- `scripts/pipeline-reset.cjs` → allowed always (even corrupted lock / tampered / pending).
- `scripts/exec-window/{open,close}.cjs` → allowed under normal pending bootstrap, DENIED when state is tampered (`stateTampered()`).

The regex tolerates quoted script paths containing spaces (this repo path has them).

**Write-verb detection stays match-anywhere** (`\b...\b`). The known false positives are fixed surgically, not by narrowing:
- `echo`/`printf` are data printers → quoted content stripped before verb scan (`echo "mv a b"` allowed).
- `install` fires only when NOT `<package-manager> install` (`npm install`, `pip3 install` allowed).
- Arrow vs redirect (F5): `->`/`=>` followed by whitespace/end is an arrow (`x -> y` allowed); `>file`, `x>file`, `var=>file` are redirects (denied).
- Interpreter deletes are matched by paren-anchored fs-method patterns (`os.remove(`, `File.delete(`, `rmSync(`, …) independent of the interpreter keyword, so a `;` inside a quoted `-c`/`-e` argument cannot hide them.

**Read-only `.codex/pipeline` allowed** (functional objective #1): the old blanket "mentions area → deny" branch is removed; only *modifying* Bash to protected state is denied. `cat`/`grep` of `.codex/pipeline/*.json` now allowed. Interpreter deletes remain denied via the broadened write patterns (closes the coverage that the removed blanket-deny previously provided).

**Deny hints:** first-actions-pending and protected-state-write denials now carry an executable, JSON-quoted `node "<abs>/scripts/pipeline-reset.cjs"` recovery command.

**pipeline-reset.cjs:** deletes exactly `workflow-intent.json`, `required-first-actions.json`, `sentinel-state.json`, `session-lock.json`, `session.json`, and `sessions/*.exec-window` strictly under `<cwd>/.codex/pipeline`; never touches ledgers (`hook-events.jsonl`, `gate-decisions.jsonl`, `confidence-score.yaml`, `fidelity-reports/`, `change-contract.json`). Emits `pipeline_reset` hook event (silent fallback) before the loop and a final outcome. Guards: per-file `lstat` before unlink (skip symlinks), realpath of pipeline dir + sessions must stay under cwd (F6 refuse), path-traversal check. stdout `{status:'RESET', removed, skipped}`. `module.exports` + `require.main` guard, CJS/Node-builtins only.

## TDD evidence

**RED (against clean HEAD)** — 10 of the new tests failed:
- pipeline-reset: 3 (script absent).
- reset-exempt-under-pending, reset-exempt-under-corrupted-lock, open-under-pending — denied on clean HEAD (no allowlist).
- F5 arrow-allow (`x -> y`/`x => y`) — denied on clean HEAD (`>` matched redirect).
- anti-regression echo, npm/pip install, `cat .codex/pipeline` — denied on clean HEAD.

The F1–F4 / F7 deny-PoCs were already GREEN on clean HEAD (match-anywhere already catches quoted/wrapped/chained write verbs, and closed-window denies). They are retained as regression guards proving the NEW allowlist exemption does not reintroduce the bypass. This differs from the "all 7 fail on clean HEAD" expectation because those findings were defects of the *reverted* WIP (verb-only matching), not of clean HEAD.

**GREEN (after implementation):**
- Batch suite (`edit-guard-hook` + `pipeline-reset` + `exec-window-scripts`): 66/66.
- Full `tests/unit/hooks` + `tests/unit/security`: 458/458.
- `npm run lint:types`: clean.

**4 anti-regression assertions — all green:** `echo "mv a b"` ALLOW; `npm install`/`pip3 install` ALLOW; `x -> y`/`x => y` ALLOW; read-only `.codex/pipeline` mention ALLOW.

## Follow-up (out of scope, unchanged)
`src/hooks/pipeline-harness.ts:106-114` generic-slash bootstrap divergence — see CONTINUE-HERE.md.
