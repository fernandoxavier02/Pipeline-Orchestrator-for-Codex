# CONSOLIDATED ADVERSARIAL REVIEW
## `pipeline-orchestrator-for-codex` v0.4.1
**Date**: 2026-05-11
**Reviewers**: Security Scanner, Architecture Critic, Codex Harness Adequacy Reviewer
**Scope**: Full codebase + Codex harness + Canonical drift analysis
**Tests at time of review**: 505/505 passing (92 files)

---

## EXECUTIVE SUMMARY

The plugin **fails adversarial review on all three dimensions**. It is not a faithful Codex port of the Claude canonical — it is a ground-up TypeScript reimplementation that:

1. **Replaces agent reasoning with imperative code** (1,879-line controller vs. canonical's 0 lines of TS)
2. **Makes emulation the default runtime** (`strictAgents` defaults to `false`; `spawn_agent` is never probed)
3. **Violates review independence** by design (synthetic findings from domain heuristics, not isolated agents)
4. **Has critical security vulnerabilities** (fail-open hooks, symlink attacks, Bash bypass, trivial prompt injection)
5. **Maintains three colliding authorities** (SKILL.md, markdown prompts, TypeScript runtime) with no SSOT

**The "505 tests passing" narrative masks an identity crisis.** The tests validate a closed circuit of mocks inside an emulation harness, not real behavior.

---

## CRITICAL FINDINGS (12)

| # | Finding | Dimension | File(s) |
|---|---------|-----------|---------|
| 1 | **Bash tool write bypass** — `edit-guard-hook.cjs` only guards `Edit`/`Write` tools; `Bash` with `>`, `>>`, `rm`, `mv` is completely unguarded | Security | `hooks/edit-guard-hook.cjs:24` |
| 2 | **Symlink attack -> arbitrary file overwrite** — `open.cjs` never checks `lstat` before `renameSync`; attacker can pre-create symlink to overwrite any file | Security | `scripts/exec-window/open.cjs:81,95` |
| 3 | **Dispatch-guard fail-open on crash** — any exception in `handle(parsed)` silently allows the dispatch | Security | `hooks/dispatch-guard.cjs:391-402` |
| 4 | **Sentinel fail-open on corrupted state** — corrupted `sentinel-state.json` -> exit 0 (allow) | Security | `hooks/sentinel-hook.cjs:108-112,181-184` |
| 5 | **"Thin wrapper" is a fat state machine** — `pipeline-controller.ts` is 1,879 lines of classification, gating, proposal logic, and phase transitions; canonical has 0 TS lines | Architecture | `src/controller/pipeline-controller.ts` |
| 6 | **Three colliding authorities with no SSOT** — SKILL.md says "thin delegator", markdown prompt says "spawn agents", TypeScript runtime IS the executor; all three contradict | Architecture | `skills/pipeline/SKILL.md`, `agents/core/pipeline-controller.md`, `src/controller/pipeline-controller.ts` |
| 7 | **Canonical drift — not a port** — Canonical: 664 markdown files, 0 TS. Port: ~70 TS files, 11,783 lines of imperative code replacing LLM reasoning | Architecture | Repository-level |
| 8 | **Subagent delegation is documentation theatre** — SKILL.md demands `spawn_agent`, but `strictAgents` defaults to `false` and the runtime never probes Codex host for availability | Harness | `src/index.ts:445` |
| 9 | **"Multi-agent" mode is parallel local emulation** — `runMultiAgentRole` runs `Promise.all` over `runSingleAgentRole`, which returns synthetic JSON from heuristics; zero real agents | Harness | `src/dispatcher/multi-agent-runner.ts` |
| 10 | **Review independence violated by design** — canonical's core guarantee (isolated adversarial review) replaced by domain-checklist heuristic (`auth`/`crypto`/`payment` -> auto-findings) | Harness | `src/dispatcher/single-agent-runner.ts:43-114` |
| 11 | **Runtime is blind to host config** — error message says "check `multi_agent = true`" but plugin **never reads** `~/.codex/config.toml` | Harness | `src/controller/pipeline-controller.ts:1107` |
| 12 | **Architectural inversion** — 1,470-line canonical orchestrator prompt exists but is **never spawned**; TypeScript state machine replaces it | Harness | `agents/core/pipeline-controller.md` vs `src/controller/pipeline-controller.ts` |

---

## HIGH FINDINGS (12)

| # | Finding | Dimension | File(s) |
|---|---------|-----------|---------|
| 13 | **Non-atomic exec-window/session-lock writes** — `unlinkSync` + `renameSync` is NOT atomic on Windows; crash between them deletes file permanently | Security | `scripts/exec-window/*.cjs`, `hooks/session-lock-hook.cjs` |
| 14 | **Gate log `appendFile` non-atomic** — concurrent appends can interleave JSONL lines, corrupting the log | Security | `src/state/gate-log.ts:24` |
| 15 | **Unknown roles default to `approved`** — attacker can dispatch `"exfiltrator"` and get `status: "approved"` | Security | `src/dispatcher/single-agent-runner.ts:429-449` |
| 16 | **Prompt injection guard trivially bypassed** — 5 regex patterns, no Unicode normalization, no synonym coverage; bypassable with `disregard all prior directives` | Security | `src/security/prompt-injection-guard.ts:5-26` |
| 17 | **State stores accept arbitrary `root`** — no path validation; attacker-controlled `root` = arbitrary file writes | Security | `src/state/*.ts` |
| 18 | **State Adapter is dead code** — `state-adapter.ts` defines clean abstraction but `pipeline-controller.ts` never imports it; redefines inline stores | Architecture | `src/controller/state-adapter.ts`, `src/controller/pipeline-controller.ts:49-77` |
| 19 | **Dispatcher is emulation harness, not bridge** — `runSingleAgentRole` is a giant `if/else` switch returning hardcoded outputs; obviates `spawn_agent` | Architecture | `src/dispatcher/single-agent-runner.ts`, `multi-agent-runner.ts` |
| 20 | **Tests validate fallback shadows, not real behavior** — mocks inside mocks; no tests against real `spawn_agent`; 14s for 26 tests indicates nested emulation loops | Architecture | `tests/integration/execution/*.test.ts` |
| 21 | **TypeScript compiler API coupling bomb** — `resolveApprovedScenarioFiles` reimplements module resolution; breaks on path mapping, custom plugins | Architecture | `src/controller/pipeline-controller.ts:807-916` |
| 22 | **Tool mapping misclassified** — `Task`->`spawn_agent` labeled "Adapted" but default path is "Emulated" (local functions) | Harness | `docs/pipeline-orchestrator-codex/07-codex-translation-matrix.md` |
| 23 | **Confidence scoring is hollow** — arithmetic over synthetic gate logs; canonical's non-invention rule is prompt-only, not runtime-enforced | Harness | `src/controller/confidence-model.ts` |
| 24 | **Hooks are parallel universes** — `hooks/hooks.json` and `.cjs` scripts exist and work, but TypeScript runtime never invokes them | Harness | `hooks/`, `src/` |

---

## MEDIUM FINDINGS (9)

| # | Finding | Dimension | File(s) |
|---|---------|-----------|---------|
| 25 | Controller lock non-atomic write | Security | `src/state/controller-lock.ts:14` |
| 26 | Session-lock clear unauthenticated | Security | `hooks/session-lock-hook.cjs:141-150` |
| 27 | Edit-guard only checks `file_path` — `MultiEdit`/`NotebookEdit` bypass via other fields | Security | `hooks/edit-guard-hook.cjs:99,134` |
| 28 | Exec-window fractional TTL bug — `0.1` passes but expires immediately | Security | `scripts/exec-window/open.cjs:65` |
| 29 | `agentRuntime` not validated — fake object can inject arbitrary code | Security | `src/dispatcher/run-role.ts:80-85` |
| 30 | Gap analysis understates multi-agent risk — treats emulation as viable fallback | Architecture | `docs/pipeline-orchestrator-codex/09-gap-analysis.md` |
| 31 | Prompt registry validation is theater — validates contracts runtime ignores | Architecture | `src/prompts/prompt-registry.ts` |
| 32 | Execution controller duplicates complexity resolution | Architecture | `src/controller/pipeline-controller.ts:166-188`, `src/execution/executor-controller.ts:341-367` |
| 33 | `request.input` forwarded without sanitization | Security | `src/dispatcher/run-role.ts:23-37` |

---

## LOW / INFO FINDINGS (4)

| # | Finding | Dimension | File(s) |
|---|---------|-----------|---------|
| 34 | Manifest missing security declarations | Security | `.codex-plugin/plugin.json` |
| 35 | Sensitive execution identity in plaintext | Security | `src/state/session-store.ts`, `src/state/gate-log.ts` |
| 36 | Sentinel stale threshold message mismatch (300s vs "60s") | Security | `hooks/sentinel-hook.cjs:199,206-210` |
| 37 | Plan mode translation is actually faithful | Harness | `src/modes/plan-mode.ts`, `plan-session.ts` |

---

## CROSS-CUTTING THEMES

### Theme A: Fail-Open by Design
Four security-critical components (`edit-guard`, `dispatch-guard`, `sentinel-hook`, `single-agent-runner`) default to "allow" on error, crash, or unknown input. This is a systemic pattern that contradicts security best practices.

### Theme B: Documentation Theatre
The project invests heavily in accurate documentation (gap analysis, translation matrix) but the runtime does not honor the documented contracts. The gap analysis is honest about individual gaps but presents an aggregated narrative of portability that is unsupported.

### Theme C: The Emulation Trap
The default runtime replaces every agent with a local function. This makes testing easy (505 tests!) but means the "production" behavior is deterministic heuristics, not LLM reasoning. The plugin cannot deliver on its core value proposition (intelligent phased execution with adversarial review) in this mode.

### Theme D: Identity Crisis
The project cannot decide whether it is:
- A faithful Codex port of the Claude canonical (it is not)
- A standalone deterministic pipeline runtime (it could be, but needs refactoring)
- A test harness for prompt contracts (it partially is, but ships as production)

### Theme E: Tests as Comfort Blanket
505 tests passing creates false confidence. The test suite proves the emulation harness works, not that the plugin works. No integration tests verify real `spawn_agent` behavior, prompt contract enforcement, or review independence.

---

## IMMEDIATE ACTION ITEMS (Priority Order)

### P0 — Security (Do Not Ship Without)
1. Fix Bash bypass in `edit-guard-hook.cjs` — add `Bash` to protected tools or disable Bash during pipeline sessions
2. Change all hook fail-open to fail-closed — `dispatch-guard.cjs`, `sentinel-hook.cjs`, `edit-guard-hook.cjs`
3. Add symlink checks to `open.cjs` and all atomic write helpers
4. Harden prompt injection guard — expand patterns, Unicode normalization, runtime input scanning
5. Validate state store roots against workspace boundary

### P1 — Architecture (Fix Before Next Release)
6. Decide identity: Codex port OR standalone runtime. Cannot be both.
7. If port: delete ~80% of TypeScript runtime; restore markdown prompts as SSOT; implement real `spawn_agent` adapter
8. If standalone: stop referencing canonical; refactor controller into bounded domain services; wire state-adapter properly
9. Extract canned emulator outputs to `test-harness/` subdirectory; make `strictAgents = true` the default
10. Fix duplicate complexity resolution — single pure function in `src/modes/`

### P2 — Harness (Close Gap Claims)
11. Probe actual Codex host for `spawn_agent` availability at runtime (read `~/.codex/config.toml` or attempt probe)
12. Reclassify `Task`->`spawn_agent` as "Emulated" in docs when `strictAgents=false`
13. Document that emulation mode breaks review independence
14. Add contract tests: lightweight HTTP server pretending to be `spawn_agent`

### P3 — Polish
15. Add security declarations to `.codex-plugin/plugin.json`
16. Fix sentinel stale threshold message (300s)
17. Consider encrypting or redacting sensitive identity in state files

---

## BOTTOM LINE

> **The plugin preserves the file structure, state schemas, and vocabulary of the canonical, but it replaces the agent reasoning layer with a TypeScript rules engine. Claiming parity with Claude Code Pipeline Orchestrator v5.2.0 is not supported by the runtime reality.**

The adversarial review team recommends:
- **Immediate**: Fix P0 security vulnerabilities before any production use
- **Short-term**: Make an architectural decision (port vs. standalone) and commit to it
- **Medium-term**: Either restore real agent dispatch or reposition the project honestly

---

*Reports generated by specialized subagents:*
- `CODEX_HARNESS_ADEQUACY_REPORT.md` — Harness reviewer
- Security scanner report — embedded in task log `agent-9zmagelw`
- Architecture critic report — embedded in task log `agent-jf6iurmc`
