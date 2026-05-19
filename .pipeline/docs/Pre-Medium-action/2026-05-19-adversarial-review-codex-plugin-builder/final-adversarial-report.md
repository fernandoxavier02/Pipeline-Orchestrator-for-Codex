# FINAL_ADVERSARIAL_REPORT — consolidated (v2 — full 3-scanner pass)

**Status: FINDINGS — not blocking, but Quality scanner would_not_approve.**

Supersedes the earlier `v1` DEGRADED report. The three independent scanners ran serially (sentinel rejected parallel spawns). Each had zero implementation context. Per-scanner reports at sibling files `scanner-security.md`, `scanner-architecture.md`, `scanner-quality.md`.

## Per-scanner verdict

| Scanner | Findings | Verdict |
| --- | --- | --- |
| Security | 11 (0 Critical · 2 High · 5 Medium · 4 Low/Info) | FINDINGS_EXIST |
| Architecture | 5 violations + 6 design risks (2 High violations · 3 Medium · multiple structural risks) | FINDINGS_EXIST |
| Quality | 11 (0 Critical · 2 High · 5 Medium · 4 Low) | would_i_approve: NO |

## Consensus findings (>=2 scanners agree)

### C1 — Ghost hook scripts in `hooks.json` template (Security + Quality)

`assets/templates/hooks.json` references five hook scripts (`session-start.cjs`, `user-prompt.cjs`, `edit-guard.cjs`, `dispatch-guard.cjs`, `completion-check.cjs`) but only `hook-deny.cjs` ships. A user copying both files gets a plugin that registers hooks but fails at runtime with file-not-found. Detected independently by Security (path/matcher coverage) and Quality (QUAL-1, DEAD-1). **Most concrete copy-paste hazard in the entire artifact set.**

### C2 — Fail-open default in `hook-deny.cjs` for a security template (Security + Quality)

`assets/templates/hook-deny.cjs` lines 51-54: the JSON parse catch block calls `allow()`. Comment says "replace with `deny(...)` if your policy needs fail-closed". This contradicts the KB's own stated principle ("fail closed for security checks"). Any corrupted stdin causes the hook to ALLOW. Security flagged the behavior (SEC-01); Quality flagged that the comment is visually indistinguishable from routine notes (CLAR-1). For a hook template explicitly named `hook-deny`, this is the wrong default.

### C3 — Sibling-skill name dead routes (Security + Architecture + Quality)

The skill body cites `plugin-dev`, `plugin-dev:plugin-structure`, and `plugin-dev:plugin-validator` in three inconsistent forms. None of these resolves to an installed skill in the current environment. Security flagged it indirectly through over-trigger / wrong-runtime risk (SEC-09); Architecture as a DIP violation (ARCH-4); Quality as a routing dead end (CLAR-2). Users following the routing reach nothing.

### C4 — Drift Notes pattern + KB↔skill duplication erodes SSOT (Architecture + Quality)

Architecture's ARCH-1 / RISK-1 / RISK-2 and Quality's QUAL-3 / CLAR-3 / QUAL-4 are different lenses on the same structural problem: the same Codex schemas live in three places (in-repo KB old per-topic files, in-repo KB consolidated guide, out-of-repo skill references) with no mechanical sync. The Drift Notes addendum at the bottom of four old KB files leaves the (incorrect) top of those files authoritative-looking; after N refresh cycles, the bottoms become a graveyard of stacked corrections. `last_verified` already differs across files (`2026-05-18` vs `2026-05-19`) — drift is already visible in the artifact set itself.

### C5 — Schema/tool-name correctness depends on unverified web claims (Security + Quality + implicitly Architecture)

The KB declares hook matchers `apply_patch|Bash` and `spawn_agent` as Codex 2026 canonical tool names, and `${PLUGIN_ROOT}` as the canonical env var. Security warned that wrong matchers silently no-op (SEC-02, SEC-03). Quality questioned schema accuracy holistically. None of the scanners independently verified claims against live Codex docs — they reviewed for internal consistency, not external truth. Claims may all be correct (they came from `developers.openai.com` fetches during construction), but the artifact set carries no machine-checked link back to those sources.

## Cross-scanner unique findings (most actionable)

**Security only:**
- SEC-04 — `marketplace.json` ships `authentication: ON_FIRST_USE` while the canonical example uses `ON_INSTALL`. Weaker default than docs.
- SEC-06 — Repo-local hook path advice (`git rev-parse --show-toplevel`) is buried with no prominence.
- SEC-07 — Undefined `${PLUGIN_ROOT}` (CI / test harness) produces silent empty-path failure; no defensive guard.
- SEC-08 — `subagent.toml` omission of `sandbox_mode` inherits parent's mode; `danger-full-access` parent silently propagates.
- SEC-10 — `plugin.json` placeholder URLs (`example.com/privacy`) pass JSON validation and may survive to marketplace submission.
- SEC-11 — `hook-deny.cjs` stdin reader has no size limit or timeout (OOM / hang risk).

**Architecture only:**
- ARCH-3 — `INDEX.md` carries both routing and SSOT-hierarchy responsibilities; SRP violation.
- ARCH-5 — `CLAUDE.md` is labeled "shim" but contains non-trivial content not in `AGENTS.md` — simultaneously shim and parallel authority.
- RISK-3 — Skill description (~1068 chars + ~20 trigger phrases + PT-BR) exceeds the skill's own template guidance (300-600 char sweet spot).
- RISK-5 — Repo-specific pipeline rules mixed with general Codex knowledge in per-topic articles.
- RISK-6 — `INDEX.md:33` glob `skills/**/*.md` is stale relative to its own corrected standalone discovery path `.agents/skills/`.

**Quality only:**
- QUAL-2 — `matcher: ""` on `UserPromptSubmit` and `Stop` in template is harmless but misleading.
- CLAR-4 — `spawn_agents_on_csv` documented in `subagents-toml.md` but missing from SKILL.md multi-agent toolset list.
- CLAR-5 — `marketplace.json` template has no placement comment.
- TEST-1 — Build checklist has no item for "every hook command path resolves to an existing file" — would have caught C1.
- TEST-2 — `hook-deny.cjs` allow-path output shape not documented.
- NAME-1 — `hook-deny.cjs` is named for example behavior, not template purpose; mismatch with `hooks.json` references.

## Contradictions

No direct contradictions between scanners. Different findings at different abstraction layers (Security: behavior; Architecture: structure; Quality: surface). Consensus findings (C1-C5) converge from independent angles.

## Overall verdict

**FINDINGS — not blocking the work as documentation/skill, but two specific copy-paste hazards (C1, C2) and one routing hazard (C3) will materially harm users who follow the artifacts to the letter. The structural concerns (C4) are slower-burning but real.**

Per the REVIEW-ONLY contract, no fixes were applied.

## Top 5 prioritized recommendations

1. **C1 (HIGH)** — Either ship the four missing `.cjs` files as runnable stubs, or rewrite `hooks.json` to a single-hook template wiring only `hook-deny.cjs` (also rename to `hook-template.cjs` per NAME-1). Add build-checklist item: "every `command` in `hooks.json` resolves to an existing file" (TEST-1).
2. **C2 (HIGH)** — Flip `hook-deny.cjs` default from `allow()` to `deny()` on parse failure. Hoist the SECURITY comment above the `try/catch` with visual prominence. Add an explicit opt-in for the fail-open variant.
3. **C3 (MEDIUM-HIGH)** — Verify the correct invocation form of the installed `plugin-dev` family and reconcile the three inconsistent references in SKILL.md to one canonical form. If no resolving sub-skill exists, replace routing with plain-language guidance.
4. **C4 (MEDIUM)** — Pick one authoritative corpus (in-repo KB OR skill references) and make the other a thin pointer. For the four older per-topic files: either rewrite the bodies to the corrected state and remove the Drift Notes pattern, or tombstone them with a single forward-pointer header. Designate one `last_verified` controller.
5. **SEC-04, SEC-08, RISK-3 (MEDIUM, batched)** — Tighten template defaults: marketplace `authentication: ON_INSTALL`; subagent `sandbox_mode = "read-only"` explicit; trim skill description to 300-600 chars (move trigger enumeration into the body's "When to use" section).

## Files reviewed

21 total — 7 KB (D:/Pipeline Orchestrator For Codex/...) + 14 skill (C:/Users/win/.claude/skills/codex-plugin-builder/...).

## Scanner outputs

- `scanner-security.md` — 11 findings + worst-case scenario walkthrough
- `scanner-architecture.md` — 5 violations + 6 design risks + dependency map + 6 structural recommendations
- `scanner-quality.md` — 11 findings + would_not_approve verdict + top-3 concerns
