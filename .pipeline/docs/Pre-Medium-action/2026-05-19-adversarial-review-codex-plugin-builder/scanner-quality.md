# Quality Review — codex-plugin-builder

Reviewer: adversarial-quality-reviewer (zero context)
Date: 2026-05-19
Files reviewed: 19

---

## QUALITY_FINDINGS

```yaml
status: "FINDINGS_EXIST"
files_reviewed: 19
```

---

## Maintainability

### QUAL-1 — HIGH — Ghost Hook Scripts in Template
**File:** `C:/Users/win/.claude/skills/codex-plugin-builder/assets/templates/hooks.json` lines 9, 22, 33, 42, 53

`hooks.json` references five `.cjs` scripts (`session-start.cjs`, `user-prompt.cjs`, `edit-guard.cjs`, `dispatch-guard.cjs`, `completion-check.cjs`). Only `hook-deny.cjs` ships in `assets/templates/`. A user who copies this template and runs `codex /plugins` gets hooks that register fine in the manifest but silently do nothing — the node commands fail at runtime with a file-not-found error, and Codex exit-code behavior on hook failure is not documented here.

The SKILL.md body (line 178) lists `hook-deny.cjs` as the only template hook but offers no warning that `hooks.json` references four additional non-existent scripts. `references/build-checklist.md` does not flag this gap. A first-time user following step-by-step workflow will copy both files and be confused when hooks appear to run but produce no effect.

**Risk:** Broken on copy-paste. A user who activates enforcement (e.g., `edit-guard`) will have a silently misconfigured plugin.

**Recommendation:** Either ship stub implementations for all five referenced scripts, or replace the multi-hook `hooks.json` template with a single-hook variant that only wires `hook-deny.cjs`, and add a note telling the user to copy that stub and rename it per hook needed. Whichever path: add a checklist item in `build-checklist.md` — "Every command in `hooks.json` resolves to a file that actually exists."

---

### QUAL-2 — MEDIUM — `matcher: ""` on Events That Ignore Matchers
**File:** `C:/Users/win/.claude/skills/codex-plugin-builder/assets/templates/hooks.json` lines 18, 49

`UserPromptSubmit` (line 18) and `Stop` (line 49) both carry `"matcher": ""`. According to `hooks-schema.md` (table at line 22-28) and `plugin-build-guide.md` (line 234), matchers on these events are silently ignored. The empty string is harmless but misleading — it creates the false impression that the matcher field is meaningful for these events. A future maintainer editing the template may try to use a regex here and be puzzled when it has no effect.

**Risk:** Misleads the reader. May cause a future maintainer to waste time debugging a non-functional matcher.

**Recommendation:** Remove the `"matcher"` key entirely from the `UserPromptSubmit` and `Stop` hook blocks, and add an inline comment explaining these events carry no matcher.

---

### QUAL-3 — MEDIUM — `last_verified` Is Scattered Across 11+ Files With No Single Controller
**Files:** All KB articles in `D:/Pipeline Orchestrator For Codex/references/openai-codex-kb/` (8 files), `C:/Users/win/.claude/skills/codex-plugin-builder/references/sources.md` line 4

`last_verified` appears in the YAML frontmatter of every KB article independently. `sources.md` line 52 instructs maintainers to "refresh `last_verified` in the skill files that depend on it" after a URL check, but there is no machine-readable link between `sources.md` and the individual article frontmatter dates. Six of the eight KB articles still carry `"2026-05-18"` while `INDEX.md` and `plugin-build-guide.md` read `"2026-05-19"` — an inconsistency that already exists as of review date.

When OpenAI changes a schema field six months from now, a maintainer must remember to update each file individually. Missing one is the expected failure mode.

**Risk:** Hard to maintain. The inconsistency is already visible; it will grow.

**Recommendation:** Establish one control point — either `sources.md` (already the refresh trigger) or a single frontmatter block in `INDEX.md` — as the canonical `last_verified` date, and change per-article dates to `see: INDEX.md` or remove them. The KB already follows a hub-and-spoke model (`plugin-build-guide.md` as SSOT); the date tracking should follow the same pattern.

---

### QUAL-4 — LOW — Five-Layer Table Duplicated in Two Locations
**Files:** `C:/Users/win/.claude/skills/codex-plugin-builder/SKILL.md` line 18, `D:/Pipeline Orchestrator For Codex/references/openai-codex-kb/plugin-build-guide.md` line 43

The five-layer mental model table appears verbatim (with minor formatting variations) in both `SKILL.md` and `plugin-build-guide.md`. Divergence is currently contained, but if Codex adds a layer or renames one, both files must be updated independently. The `plugin-build-guide.md` version also includes a `Memories` row (line 50) that the `SKILL.md` table omits — a visible inconsistency already.

**Risk:** Hard to maintain. The omission of `Memories` is the first sign of drift.

**Recommendation:** Remove the table from `SKILL.md` and replace with a one-line summary plus a "Read X when Y" pointer to `plugin-build-guide.md`, consistent with the progressive-disclosure pattern the skill already uses for all other reference material.

---

## Clarity

### CLAR-1 — HIGH — Fail-Open in `hook-deny.cjs` Is Not Visually Prominent
**File:** `C:/Users/win/.claude/skills/codex-plugin-builder/assets/templates/hook-deny.cjs` line 51-54

The comment `// Fail open on malformed input — replace with deny(...) if your policy needs fail-closed.` is inline, in the same voice as every other comment in the file. For a security-enforcement hook that ships as a template, this is the single most consequential behavioral choice a user can make. A maintainer skimming the file to understand behavior will read it as just another implementation note, not as a security posture decision they must consciously make.

The comment is accurate. The code is correct. But the prominence does not match the consequence.

**Risk:** A user copying this template for a security enforcement use-case (e.g., blocking secret-exfiltration commands) gets fail-open behavior without realizing they opted into it. The deny path is absent on parse failure.

**Recommendation:** Move the fail-open comment above the `try/catch` block and mark it with a label that stands out visually — a `SECURITY:` prefix, a blank line before and after, or a multi-line block comment. The goal is that someone reading at speed cannot miss the posture decision.

---

### CLAR-2 — MEDIUM — `plugin-dev:plugin-validator` Is Referenced but Does Not Exist
**File:** `C:/Users/win/.claude/skills/codex-plugin-builder/SKILL.md` line 154

The "What this skill does not do" section routes users to `plugin-dev:plugin-validator` for Claude Code plugin validation. No skill by that name exists in `~/.claude/skills/`. The description also routes users at line 3 to `plugin-dev:plugin-structure` (for Claude Code plugins), which also has no matching directory.

The body routing (line 14) uses just `plugin-dev` without the sub-skill suffix, which is a third variant of the same reference, creating three inconsistent forms.

**Risk:** Misleading. A user who follows the routing instruction hits a dead end.

**Recommendation:** Verify whether a `plugin-dev` skill exists in the user's installed skill set (it appears in the system-reminder skill list). If it does, use its correct invocation form consistently across all three references. If it does not, replace the routing with a plain-English instruction ("for Claude Code plugins, check the Claude Code plugin documentation").

---

### CLAR-3 — MEDIUM — Drift Notes Are Near-Duplicate Across Four Files
**Files:** `D:/Pipeline Orchestrator For Codex/references/openai-codex-kb/plugins.md` line 112, `skills.md` line 107, `agents-and-subagents.md` line 123, `rules-hooks-agents-md.md` line 118

All four drift notes open with the same sentence: "See [plugin-build-guide.md] for the schema-accurate consolidated version." Each then restates a subset of the corrections that live verbatim in `plugin-build-guide.md`. The hooks corrections in `rules-hooks-agents-md.md` (line 120) and `plugin-build-guide.md` (lines 403-411) repeat the same bullet list nearly word for word.

The drift notes serve a legitimate purpose — they flag that the surrounding article is older than the guide. But the near-duplicate content means that when a correction changes in `plugin-build-guide.md`, maintainers must check all four satellite files to keep the summaries from diverging.

**Risk:** Hard to maintain. The pattern will produce silent inconsistencies over time, exactly what the drift notes are meant to prevent.

**Recommendation:** Shorten each drift note to one sentence ("This article predates `plugin-build-guide.md`; see that file for schema-accurate corrections.") and remove the restated correction bullets. The full content lives in the guide; the note's only job is to redirect.

---

### CLAR-4 — LOW — `subagent.toml` Template Has `spawn_agents_on_csv` in `subagents-toml.md` but Not in `SKILL.md` Multi-Agent Toolset List
**Files:** `C:/Users/win/.claude/skills/codex-plugin-builder/SKILL.md` line 109, `C:/Users/win/.claude/skills/codex-plugin-builder/references/subagents-toml.md` line 91

`SKILL.md` body lists the multi-agent toolset as `spawn_agent`, `send_input`, `resume_agent`, `wait_agent`, `close_agent` — five tools. `subagents-toml.md` includes `spawn_agents_on_csv` (with the companion `report_agent_job_result`) as a sixth tool in the same table. `plugin-build-guide.md` line 343 mentions `spawn_agents_on_csv` only in a config comment. A reader of `SKILL.md` alone will not know the batch-spawn tool exists.

**Risk:** Incomplete picture for a user operating from SKILL.md without loading the reference.

**Recommendation:** Add `spawn_agents_on_csv` to the parenthetical toolset list in SKILL.md line 109, or add a one-line note directing users to `subagents-toml.md` for the complete set.

---

### CLAR-5 — LOW — `marketplace.json` Template Has No Placement Comment
**File:** `C:/Users/win/.claude/skills/codex-plugin-builder/assets/templates/marketplace.json`

`subagent.toml` opens with a comment block (lines 1-6) telling the user exactly where to place the file. `marketplace.json` has no such guidance. The correct placement (`$REPO_ROOT/.agents/plugins/marketplace.json` or `~/.agents/plugins/`) is non-obvious, especially since the legacy path (`.codex-plugin/marketplace.json`) still works and is a common mistake. `manifest-schema.md` documents the layout, but a user who only copies the template file will not know to look there.

**Risk:** Increases the chance the user places the file at the legacy path.

**Recommendation:** Add a JSON comment (or a sibling `marketplace.json.placement.txt`) with the canonical path. Since JSON does not support comments, the most pragmatic approach is a `_placement` key with a string value that starts with `REMOVE_BEFORE_SHIP:`, consistent with how other scaffolding tools communicate placement intent.

---

## Testability

### TEST-1 — MEDIUM — Build Checklist Has No Local Validation Step for Hook Script Existence
**File:** `C:/Users/win/.claude/skills/codex-plugin-builder/references/build-checklist.md` lines 26-31

The Hooks section of the checklist verifies type, env var, matcher validity, and deny output shape — but does not include a step to verify that every `command` in `hooks.json` resolves to a file that exists. This is directly related to QUAL-1. The checklist is the last defense before shipping; the missing file check is the exact class of error that a copy-paste user would hit.

**Risk:** The checklist passes but the plugin is broken. This directly enables the QUAL-1 hazard.

**Recommendation:** Add a checklist item: "Every `command` value in `hooks.json` resolves to a file that exists at the path Codex will use (`${PLUGIN_ROOT}/hooks/<name>.cjs` or equivalent). Verify by listing the hooks directory."

---

### TEST-2 — LOW — `hook-deny.cjs` Has No Test for the Allow Path
**File:** `C:/Users/win/.claude/skills/codex-plugin-builder/assets/templates/hook-deny.cjs`

The template demonstrates the deny path (lines 61-64) and the allow path (line 66), but provides no test or example of what a successful allow looks like at the Codex layer (i.e., empty object `{}` on stdout, exit 0). `hooks-schema.md` line 163 clarifies that empty stdout is treated as success, but the template comment only describes the deny shape in the wiring example. A maintainer adding a new condition might add `deny(...)` to the wrong branch without noticing that `allow()` writes `'{}'` — not empty string.

**Risk:** Low — the code is small enough to audit directly. But the absence of even one passing test scenario in the comments increases the chance of a subtle output-format mistake.

**Recommendation:** Add a one-line example output comment above `allow()` showing `// → stdout: {}  exit 0` and above `deny(...)` showing `// → stdout: <JSON>  exit 0`, consistent with how the wiring example in the doc comment already shows the input side.

---

## Dead Code

### DEAD-1 — MEDIUM — Four Hook Script References With No Matching Files
**File:** `C:/Users/win/.claude/skills/codex-plugin-builder/assets/templates/hooks.json` lines 9, 22, 33, 42

Commands for `session-start.cjs`, `user-prompt.cjs`, `edit-guard.cjs`, `dispatch-guard.cjs` point to files that do not exist in `assets/templates/` and are not described in any reference file as stubs to be filled in. From the reader's perspective these are dead references — they reference unreachable artifacts.

Evidence: `ls assets/templates/` returns only `hook-deny.cjs`, `hooks.json`, `marketplace.json`, `plugin.json`, `SKILL.md`, `subagent.toml`.

**Kind:** dead-reference (unreachable artifact)

**Recommendation:** See QUAL-1. The resolution to QUAL-1 resolves this finding simultaneously.

---

## Naming

### NAME-1 — LOW — `hook-deny.cjs` Name Does Not Generalize
**File:** `C:/Users/win/.claude/skills/codex-plugin-builder/assets/templates/hook-deny.cjs`

The template is the only shipped hook implementation, but the `hooks.json` template wires it under the matcher `Bash` with the name `dispatch-guard.cjs`, `edit-guard.cjs`, etc. The actual shipped file is named `hook-deny.cjs`, which is accurate for its example behavior (deny `rm -rf`) but conflicts with the more specific names in `hooks.json`. A user following the workflow sees two different naming conventions and must reconcile them.

**Current name:** `hook-deny.cjs`

**Problem:** The name suggests "a hook that denies", which describes the example behavior, not the template pattern. When a user reads `hooks.json` referencing `session-start.cjs` and then opens `assets/templates/` to find only `hook-deny.cjs`, the relationship is not obvious.

**Suggested direction:** Rename to `hook-template.cjs` or `hook-example.cjs` to communicate "this is the pattern to copy and specialize", not "this is the deny hook to wire directly." Alternatively, add a comment at the top of `hooks.json` pointing to the shipping file: `// Copy and rename hook-deny.cjs for each hook entry above.`

---

## Summary

```yaml
would_i_approve: "NO"

top_3_concerns:
  - "QUAL-1 / DEAD-1: hooks.json template references 4 hook scripts that do not exist.
     A user who copies both template files gets silently non-functional enforcement hooks.
     This is the highest-severity broken-on-copy-paste hazard in the artifact set."
  - "CLAR-1: The fail-open posture in hook-deny.cjs is a security posture decision
     buried in an inline comment indistinguishable from routine implementation notes.
     A user building a security enforcement hook will inherit fail-open without
     realizing it."
  - "CLAR-2: plugin-dev:plugin-validator and plugin-dev:plugin-structure are referenced
     as routing targets but do not exist as installed skills. The references are
     dead ends for the user they are meant to help."
```

---

## Notes on What Is Clean

The following areas showed no quality issues worth requesting changes on:

- `plugin.json` template: valid JSON, paths correct, no dead references.
- `marketplace.json` template: valid JSON, `source.source` enum value correct, `policy` fields match schema.
- `subagent.toml` template: commented-out `model` line is a valid TOML comment (line 28 begins with `#`); `model_reasoning_effort = "high"` on line 29 is an active field — the advertised "inherits parent model" behavior is correct because `model` is omitted, not `model_reasoning_effort`. The template is internally consistent with `subagents-toml.md`.
- `SKILL.md` body length: 180 lines — comfortably under the 500-line cap the skill itself mandates.
- Progressive disclosure pointers: consistent and specific throughout SKILL.md.
- `sources.md`: URL table is coherent and the refresh procedure is actionable.
- `hooks-schema.md`: event table, input/output contract, and exit code table are internally consistent.
- CLAUDE.md (repo): clearly identifies itself as a Claude Code shim, defers to AGENTS.md, and lists concrete commands. Not redundant with AGENTS.md in a harmful way.
- KB `INDEX.md`: article map is accurate for the articles reviewed; `globs` frontmatter makes retrieval decisions explicit.
