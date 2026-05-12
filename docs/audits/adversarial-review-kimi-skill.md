# Adversarial Review — Kimi Skill Port

**Reviewer:** Kimi (self-review, adversarial mode)  
**Scope:** `.kimi/skills/` + `.agents/skills/` (entire Kimi plugin)  
**Canonical baseline:** `D:\Pipeline Orchestrator Claude\Pipeline-Orchestrator` (v5.0.0)  
**Date:** 2026-05-11  
**Method:** Static analysis + contract comparison + runtime gap analysis

---

## Executive Summary

| Severity | Count | Status |
|---|---|---|
| **CRITICAL** | 4 | 0 resolved |
| **HIGH** | 6 | 0 resolved |
| **MEDIUM** | 5 | 0 resolved |
| **LOW** | 4 | 0 resolved |
| **TOTAL** | **19** | **0 resolved** |

**Verdict: NO-GO for production use.**

The port preserves the canonical architecture at a structural level (4 phases, gate protocol, thin delegator) but has **critical fidelity gaps** in agent prompts, **security regressions** due to missing hooks, and **runtime incompatibilities** with Kimi tool names. The skill would run but produce unreliable or unsafe results.

---

## CRITICAL Findings

### C1 — Agent Prompts Are Empty Templates (Behavioral Collapse)

**Location:** `agents/pipeline-controller.md`, all Phase 0–3 DISPATCH_REQUEST blocks

**Finding:** The controller emits DISPATCH_REQUESTs with minimal prompts like:

```yaml
prompt: |
  You are the task-orchestrator agent.
  Request: [extracted from user arguments]
  ... produce CLASSIFICATION with:
```

The canonical `agents/core/task-orchestrator.md` is **~200 lines** of detailed classification logic (step-by-step reasoning, ssot conflict detection, complexity heuristics, variant inference rules). The Kimi port gives the subagent a **5-line generic prompt** and expects equivalent output.

**Impact:** The `coder` subagent will hallucinate classifications, miss ssot conflicts, mis-infer complexity, and produce inconsistent pipeline_variant. The entire Phase 0 collapses from deterministic to stochastic.

**Same issue affects:** information-gate, design-interrogator, executor-controller, review-orchestrator, final-validator, sanity-checker, all 3 adversarial scanners.

**Canonical fidelity:** ~15% (structural form preserved, behavioral content lost)

**Fix:** Inline the full canonical agent prompts into each DISPATCH_REQUEST, or create per-agent `.md` files in `agents/` and have the controller `ReadFile` them before dispatch. The second option is cleaner and preserves the canonical SSOT.

---

### C2 — Wrong Tool Names for Kimi Runtime (Tool Mismatch)

**Location:** `agents/pipeline-controller.md` lines 4, 15–17

**Finding:**

| Claimed in controller | Actual Kimi `coder` tools |
|---|---|
| `Read` | `ReadFile`, `ReadMediaFile` |
| `Write` | `WriteFile`, `StrReplaceFile` |
| `Bash` | `Shell` |
| `Glob`, `Grep` | `Glob`, `Grep` ✅ |

The controller frontmatter says `tools: Read, Write, Glob, Grep, Bash` and instructs itself to use `Read`, `Write`, `Bash`. A Kimi `coder` subagent does **not** have these tools. It will error or fall back to generic behavior when trying to invoke them.

**Impact:** File operations fail. Build/test commands fail. The controller cannot write sentinel-state.json, cannot read references, cannot run PROJECT_CONFIG commands.

**Fix:** Update all tool references to Kimi-native names: `ReadFile`, `WriteFile`, `Shell`.

---

### C3 — No Deterministic Exec-Window (Security Regression)

**Location:** `agents/pipeline-controller.md`, Step 2c (Implementation)

**Finding:** The canonical uses tested Node.js wrappers (`scripts/exec-window/open.cjs`) that atomically validate session locks, write JSON, append audit lines, and enforce TTL bounds. The Kimi port instructs the controller to **manually write** `.pipeline/sessions/<id>.exec-window` as raw JSON.

**Impact:**
1. LLM may malform JSON, skip audit line, or miss TTL bounds.
2. Without `edit-guard-hook.cjs` (Claude-only), there is **zero enforcement** that edits outside `.pipeline/` require an exec-window.
3. The `coder` subagent has `WriteFile`/`StrReplaceFile` and can edit **any file** in the project without restriction.

**Security verdict:** This is a **regression from cooperative authorization to no authorization**. The canônico's Iron Law #1 (edit guard) is completely absent.

**Fix:** Either (a) implement a Kimi-compatible exec-window script in `scripts/`, or (b) accept the security regression and document it prominently. Option (a) is strongly preferred.

---

### C4 — Subagent Has Unrestricted Write Access (Missing Enforcement Layer)

**Location:** Architecture-level

**Finding:** The canônico has 8 hooks (`.claude/hooks/`) that enforce:
- `edit-guard-hook.cjs` — blocks edits outside `.pipeline/` without exec-window
- `dispatch-guard.cjs` — validates agent dispatches match skill manifest
- `sentinel-hook.cjs` — validates spawn sequence against sentinel state
- `session-lock-hook.cjs` — prevents concurrent pipeline sessions
- `session-cleanup-hook.cjs` — cleans orphan locks on Stop event
- `completion-checklist.cjs` — enforces gate decision logging
- `force-pipeline-agents.cjs` — forces user gates at prescribed steps
- `skill-frontmatter-parser.cjs` — parses SKILL.md frontmatter for enforcement

**Kimi has no hook system.** None of these enforcements exist in the Kimi runtime.

**Impact:**
- A compromised or confused `coder` subagent can delete, modify, or exfiltrate any project file.
- Concurrent `/pipeline` invocations have no mutual exclusion.
- Sentinel state is advisory only — no hook validates it.
- Gate decisions may not be logged; final-validator may receive incomplete data.

**Fix:** Document as known architectural limitation. Implement compensating controls in SKILL.md (e.g., parent must verify file paths before allowing edits). Consider adding a pre-flight bash script that the parent runs before spawning the controller.

---

## HIGH Findings

### H1 — `{{arguments}}` Substitution Uncertain

**Location:** All `SKILL.md` files (pipeline, bugfix, feature, audit, review, spec)

**Finding:** All skills use `{{arguments}}` as a template variable:

```markdown
prompt: "You are the pipeline-controller. User request: {{arguments}}"
```

This is Claude Code's template syntax. **It is unverified whether Kimi Code CLI substitutes this variable.** If Kimi does not, the controller receives the literal string `"User request: {{arguments}}"` and has no actual user request to process.

**Impact:** Pipeline runs with empty or malformed input. Classification fails. User confusion.

**Fix:** Replace with explicit instructions: "Use the user's full message as the request text." Or test `{{arguments}}` substitution empirically and document the result.

---

### H2 — Reference Paths Are Hardcoded and Potentially Inaccessible

**Location:** `agents/pipeline-controller.md`, Step 2a

**Finding:** The controller instructs itself to read:

```
.kimi/skills/pipeline/references/pipelines/{variant}.md
```

But the skill may be installed at:
- `~/.kimi/skills/pipeline/references/...` (user level)
- `.agents/skills/pipeline/references/...` (project level)
- `C:\Users\win\.kimi\skills\pipeline\references\...` (Windows absolute)

A `coder` subagent running in the project directory cannot resolve `~/.kimi/skills/...` without knowing the user's home path. It also may not know which install location was used.

**Impact:** The controller fails to load pipeline references, cannot determine team composition or step order, and falls back to improvised behavior.

**Fix:** Pass the skill's absolute install path as part of the controller's prompt. Or inline the essential reference content into the controller prompt. Or create a resolver script.

---

### H3 — Review-Orchestrator Context Isolation Is Fragile

**Location:** `agents/pipeline-controller.md`, Step 2e

**Finding:** The canônic enforces "ZERO implementation context" for the review-orchestrator by not passing implementation summaries, design decisions, or executor reasoning. In the Kimi port, the review-orchestrator is an `explore` subagent with a minimal prompt. The subagent must independently discover and read the modified files.

**However:** The `explore` subagent has `ReadFile`/`Glob`/`Grep` tools. If the parent includes `files_modified` in the prompt, the subagent can read them. But if the parent does not include absolute paths or the subagent misconstructs paths, the review will fail.

**Impact:** Reviews may be incomplete, based on stale files, or skip files entirely.

**Fix:** Include explicit file paths (absolute or project-relative) in the REVIEW_CONTEXT prompt. Add a verification step where the review-orchestrator lists the files it actually read.

---

### H4 — No Controller Failure Handling

**Location:** All `SKILL.md` files

**Finding:** The protocol handler loop assumes the controller always returns structured blocks. There is **no instruction** for what to do if:
- The controller returns plain text (no blocks)
- The controller errors out (tool failure, context overflow)
- The controller enters an infinite loop of AWAITING_* without progress
- The controller emits malformed YAML

**Impact:** Parent LLM may loop indefinitely, present garbage to the user, or silently abort.

**Fix:** Add a circuit-breaker rule: "If the controller returns 3 consecutive malformed responses, or does not emit PIPELINE COMPLETE after N re-dispatches (suggest 20), stop and report failure to the user."

---

### H5 — REVIEW-ONLY Mode Is Unimplemented

**Location:** `agents/pipeline-controller.md` mode table + `skills/review/SKILL.md`

**Finding:** The mode table lists `review-only` but the controller workflow has **no implementation section** for it. The `review/SKILL.md` dispatches `MODE=review-only` to the controller, but the controller does not have a `IF MODE == review-only` handler.

**Impact:** Review-only invocations run the full pipeline instead of skipping to final adversarial.

**Fix:** Add a Step 0 in the controller: "If MODE=review-only, skip to Step 3b-pre (Final Adversarial Gate) after detecting modified files."

---

### H6 — `target_kind` vs `target_type` Schema Drift

**Location:** `agents/pipeline-controller.md` DISPATCH_REQUEST blocks

**Finding:** The controller emits blocks with `target_kind: agent` (canonical schema) but the Kimi protocol adaptation uses `target_type: coder | explore`. The SKILL.md parent handler looks for `target_type`. The controller emits `target_kind`.

**Impact:** Parent parser may fail to extract the subagent type, default to `coder`, or crash.

**Fix:** Standardize on `target_type` everywhere. Update controller DISPATCH_REQUEST template.

---

## MEDIUM Findings

### M1 — Controller Prompt Is ~24KB (Context Pressure)

**Location:** `agents/pipeline-controller.md`

**Finding:** The full controller prompt is 740 lines (~24KB). When dispatched as a subagent prompt, plus tool outputs, plus re-dispatch prepend payloads (GATE_RESPONSES, DISPATCH_RESULTS), the context window fills rapidly.

**Impact:** Context overflow on complex pipelines (MEDIA/COMPLEXA with multiple batches). Token cost explosion. Potential truncation of critical instructions.

**Mitigation:** The canônic has the same issue (1470 lines). This is architectural, not a port-specific bug. Document as known limitation.

---

### M2 — SetTodoList Timing Is Undefined

**Location:** `skills/pipeline/SKILL.md`

**Finding:** The SKILL.md says "Use SetTodoList to show pipeline progress" but does **not** specify WHEN to update it. After each phase? After each gate? After each re-dispatch?

**Impact:** Inconsistent user experience. Some parents may never update it; others may update excessively.

**Fix:** Add explicit timing: "Update SetTodoList after every phase transition (0→1, 1→1.5, 1.5→2, 2→3) and after every gate decision."

---

### M3 — Zero Tests for Kimi Skill

**Location:** Entire `.kimi/skills/` tree

**Finding:** The canonical has 166 tests (8 hook tests + unit + integration + BDD). The Kimi port has **zero** tests. No validation that:
- The protocol blocks parse correctly
- The parent handler loop terminates
- The controller emits valid YAML
- File paths resolve correctly

**Impact:** Bugs discovered only in production. No regression safety.

**Fix:** Add at minimum a YAML block validator test and a parent-handler simulation test. Consider using the existing Node test infrastructure with a Kimi-specific test suite.

---

### M4 — Protocol Handler Duplicated Across 6 Skills

**Location:** All `SKILL.md` files (pipeline, bugfix, feature, audit, review, spec)

**Finding:** Each skill repeats the full 7-step protocol handler loop. This is ~30 lines × 6 files = 180 lines of duplicated logic.

**Impact:** Maintenance burden. Drift risk. If the protocol evolves (e.g., new block type), all 6 files must be updated.

**Fix:** Extract the protocol handler into a single reference file (`references/parent-handler-protocol.md`) and have each SKILL.md link to it: "Handle protocol blocks per `references/parent-handler-protocol.md`". Keep only skill-specific dispatch logic in each SKILL.md.

---

### M5 — `model: inherit` Behavior Unverified

**Location:** `agents/pipeline-controller.md` line 5

**Finding:** The controller frontmatter includes `model: inherit`. In Claude Code, this means "use the same model as the parent". In Kimi, `Agent` tool accepts `model` parameter but `inherit` is not documented in the available specs.

**Impact:** If unsupported, the subagent may default to a weak model, causing poor reasoning quality in the controller.

**Fix:** Remove `model: inherit` or verify empirically that Kimi supports it. Default to explicit model if uncertain.

---

## LOW Findings

### L1 — Claude-Specific Frontmatter Fields

**Location:** All `SKILL.md` files

**Finding:** Fields like `disable-model-invocation`, `allowed-tools`, `argument-hint`, `color` are Claude Code conventions. Kimi's skill-creator documentation says: "Do not include any other fields in YAML frontmatter." While extra fields are likely ignored, they create confusion and bloat.

**Fix:** Strip all non-essential frontmatter fields. Keep only `name` and `description`.

---

### L2 — README.md Inside Skills Directory

**Location:** `.kimi/skills/README.md`

**Finding:** The skill-creator guideline explicitly says: "Do NOT create extraneous documentation or auxiliary files, including: README.md". The README was copied to `~/.kimi/skills/README.md` and `.agents/skills/README.md` during installation.

**Impact:** Clutter. May confuse Kimi's skill loader.

**Fix:** Move README to repo root (e.g., `KIMI_SKILL_README.md`) and delete from skills install paths.

---

### L3 — Version Inconsistency

**Location:** `agents/pipeline-controller.md` line 9

**Finding:** The controller declares "Kimi port — v1.0" while the canonical is v5.0.0. This creates confusion about maturity and feature parity.

**Fix:** Use a version that signals port status: `v5.0.0-kimi-port-0.1` or similar.

---

### L4 — Slash-Command Mentions in Descriptions

**Location:** All `SKILL.md` descriptions

**Finding:** Descriptions mention `Invoked via /pipeline [task]`, `/bugfix [task]`, etc. Kimi does not have slash commands. Skills activate via semantic matching of `description`.

**Impact:** Users may try to type `/pipeline` and Kimi won't recognize it. The description space is wasted on syntax that doesn't exist.

**Fix:** Rewrite descriptions to focus on natural-language triggers: "Use when you need to...", "Activate for rigorous bug fix execution with..."

---

## Cross-Reference to Canonical

| Canonical Feature | Kimi Port Status | Gap Severity |
|---|---|---|
| 8 enforcement hooks | Absent | CRITICAL |
| 19 agent prompts (200+ lines each) | Empty templates (5–10 lines each) | CRITICAL |
| Exec-window scripts (deterministic) | Manual JSON write | CRITICAL |
| `Read`/`Write`/`Bash` tools | `ReadFile`/`WriteFile`/`Shell` | CRITICAL |
| `{{arguments}}` substitution | Unverified | HIGH |
| Reference path resolution | Hardcoded, fragile | HIGH |
| Review context isolation | Fragile (no path enforcement) | HIGH |
| Controller failure handling | Absent | HIGH |
| REVIEW-ONLY mode | Unimplemented | HIGH |
| 166 tests | 0 tests | MEDIUM |
| Protocol handler DRY | Duplicated ×6 | MEDIUM |
| Visible plan (`SetTodoList`) | Timing undefined | MEDIUM |
| Version parity | v1.0 vs v5.0.0 | LOW |
| Slash-command UX | Non-existent in Kimi | LOW |

---

## Recommendations

### To reach GO (minimum viable):

1. **Fix C1 (agent prompts):** Create `agents/task-orchestrator.md`, `agents/information-gate.md`, etc., and have the controller `ReadFile` them before dispatch, or inline full prompts.
2. **Fix C2 (tool names):** Replace `Read`→`ReadFile`, `Write`→`WriteFile`, `Bash`→`Shell` throughout controller.
3. **Fix H1 (arguments):** Verify or replace `{{arguments}}` substitution.
4. **Fix H5 (review-only):** Add mode handler to controller.
5. **Fix H6 (schema drift):** Standardize `target_type` in controller.

### To reach CONDITIONAL (production-ready with warnings):

6. **Address C3 (exec-window):** Create `scripts/open-exec-window.sh` and `scripts/close-exec-window.sh` as deterministic wrappers.
7. **Address C4 (hooks):** Document security regression. Add compensating parent-side path validation before allowing any file edit.
8. **Address H2 (reference paths):** Pass absolute skill path to controller prompt.
9. **Address H4 (failure handling):** Add circuit-breaker rules to SKILL.md.
10. **Address M3 (tests):** Add YAML block validator + parent-handler simulation tests.

### To reach full parity with canonical:

11. Implement sentinel state validation in parent handler.
12. Add session lock management (even if advisory).
13. Add gate decision log validation before final-validator.
14. Create per-variant skill files with prescriptive steps (bugfix-light, feature-heavy, etc.).
15. Port the 166-test suite to cover Kimi-specific behavior.

---

*Review complete. 19 findings. 0 resolved. Pipeline status: NO-GO.*
