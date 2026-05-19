# Final Adversarial Report — Codex Plugin Builder (Skill + KB)

- **Date:** 2026-05-19
- **Mode:** REVIEW-ONLY (degraded — see “Contract Failure” below)
- **Complexity:** MEDIA
- **Pipeline variant:** review-only
- **Reviewer composition (actual):** 1 single in-thread reviewer (Claude Opus 4.7, full context — NOT independent)
- **Reviewer composition (contracted but not delivered):** 3 parallel context-independent scanners
  - `pipeline-orchestrator:executor:type-specific:adversarial-security-scanner`
  - `pipeline-orchestrator:executor:type-specific:adversarial-architecture-critic`
  - `pipeline-orchestrator:executor:type-specific:adversarial-quality-reviewer`

---

## Contract Failure (READ FIRST)

The orchestrator spec for this skill (final-adversarial-orchestrator) requires three independent adversarial subagents spawned in a **single parallel message**, then a cross-reference pass producing **consensus / unique / contradiction** findings.

In this session those subagents are **not registered** as callable tools:

- `ToolSearch` for the three names returned “No matching deferred tools found”.
- No generic `Task` / agent-spawn tool with `subagent_type: pipeline-orchestrator:executor:type-specific:adversarial-*` is exposed.
- The higher-level `pipeline-orchestrator:pipeline` skill is available but would re-enter intake/classification and is not a substitute for the three context-independent scanners (the whole point of the gate is independence).

I therefore **refused to fabricate** three separate scanner verdicts and a consensus table from a single pass. Instead this document is an honest single-reviewer self-audit, explicitly labeled, so the session is not a total loss. **It must not be marked as the final adversarial gate.** Re-run from a session where the three subagents are mounted.

---

## Scope reviewed (file list, complete)

KB (inside repo `D:/Pipeline Orchestrator For Codex/`):
- NEW `CLAUDE.md` (shim → AGENTS.md / .kiro/ SSOT)
- NEW `references/openai-codex-kb/plugin-build-guide.md` (~412 lines, consolidated SSOT)
- MOD `references/openai-codex-kb/INDEX.md`
- MOD `references/openai-codex-kb/plugins.md` (appended Drift Notes 2026-05-19)
- MOD `references/openai-codex-kb/skills.md` (idem)
- MOD `references/openai-codex-kb/agents-and-subagents.md` (idem)
- MOD `references/openai-codex-kb/rules-hooks-agents-md.md` (idem)

Skill (outside repo, user global): `C:/Users/win/.claude/skills/codex-plugin-builder/`
- `SKILL.md` (~181 lines)
- `references/{sources,manifest-schema,skill-format,hooks-schema,subagents-toml,marketplace,build-checklist}.md`
- `assets/templates/{plugin.json,SKILL.md,hooks.json,hook-deny.cjs,subagent.toml,marketplace.json}`

Tests: none added (work is docs/skill, not runtime code).

---

## Per-scanner verdict

| Scanner | Status | Rationale |
| --- | --- | --- |
| adversarial-security-scanner | **NOT RUN** | Subagent unavailable. See Contract Failure. |
| adversarial-architecture-critic | **NOT RUN** | Subagent unavailable. |
| adversarial-quality-reviewer | **NOT RUN** | Subagent unavailable. |
| single-reviewer self-audit (this pass) | **CONDITIONAL** — findings exist; none blocking | See findings below |

---

## Single-reviewer findings (NOT a substitute for the 3-scanner team)

Severity scale: Critical / High / Medium / Low / Info. File:line evidence cited where applicable.

### F1 — High — Skill description likely OVER-triggers and overlaps with `plugin-dev`

- **File:** `C:/Users/win/.claude/skills/codex-plugin-builder/SKILL.md:2-3`
- **Evidence:** description is ~1100 chars, bilingual (EN+PT), enumerates ~20 trigger phrases, and reaches for ambiguous phrases like “build a codex skill” and “codex hooks.json”.
- **Risk:** The Codex CLI and Claude Code share the word “codex” in user vocabulary (some users say “codex” meaning OpenAI Codex; others use the brand loosely). Codex / Claude Code both use plugin.json, skills, hooks.json — same nouns, different schemas. A long description that says “use this when the user asks to … create a plugin … hooks.json … subagent” risks being matched even when the user is in a Claude Code context.
- **Disambiguation language IS present** (“the GPT-powered Codex — NOT Claude Code; for Claude Code plugins use plugin-dev:plugin-structure instead”) which mitigates somewhat, but is buried inside a wall of triggers. Description routers degrade in long-form prose.
- **Recommendation (advisory, no fix in REVIEW-ONLY):** Consider splitting into 2–3 short trigger groups and putting the negative disambiguation at the very top of `description`. Verify routing with a few canary prompts (“build a plugin for codex”, “write a codex skill”) and (“build a plugin for claude code”, “write a skill”).

### F2 — High — “Drift Notes” are unverified web claims

- **Files:** all five `references/openai-codex-kb/*.md` Drift Notes sections, plus the new `plugin-build-guide.md` whole document.
- **Evidence:** `plugin-build-guide.md:35` declares `last_verified: "2026-05-19"`, and the Drift Notes list ~10 concrete schema corrections (hook types parsed-but-skipped, subagents are TOML, `${PLUGIN_ROOT}` canonical, marketplace at `.agents/plugins/marketplace.json`, multi-agent toolset default-on since 2026, `AGENTS.override.md` precedence, 32 KiB doc cap, etc.).
- **Risk:** This single reviewer cannot independently verify the claims against the live OpenAI docs (no web fetch was performed in this pass; the dispatching context says the work claims verification on 2026-05-19 but does not attach evidence). If any of these claims is wrong, the entire SSOT inverts: prior KB pages become correct, new guide becomes drift. The corrections most fragile to verify:
  - Hook `type: "prompt"` / `type: "agent"` as **parsed-but-skipped** (not “unsupported”).
  - `[features].plugin_hooks` **default-enabled since 2026**.
  - Marketplace canonical at `.agents/plugins/marketplace.json`, with `.codex-plugin/marketplace.json` as legacy.
  - `${PLUGIN_ROOT}` canonical with `${CLAUDE_PLUGIN_ROOT}` legacy.
  - Multi-agent toolset (`spawn_agent`, `send_input`, `resume_agent`, `wait_agent`, `close_agent`) on by default since 2026.
  - Custom subagents as TOML in `.codex/agents/` (not Markdown).
- **Recommendation:** Before merge, the next session with web access should open each `source_urls` URL in `plugin-build-guide.md:13-23` and confirm each Drift Notes bullet line-by-line. Treat any unverifiable claim as “HYPOTHESIS — needs verification” and downgrade the document’s authority until checked.

### F3 — Medium — SSOT discipline weak: old per-topic pages still authoritative-looking

- **Files:** `plugins.md`, `skills.md`, `agents-and-subagents.md`, `rules-hooks-agents-md.md`.
- **Evidence:** Each old page got a Drift Notes section appended (e.g., `plugins.md:112-114`) pointing forward to `plugin-build-guide.md`, but the **body of each page still presents pre-correction guidance as current** without an inline warning. A user reading top-down hits the (possibly wrong) body before they hit the Drift Notes at the bottom.
- **Risk:** Users / agents that grep for a specific topic (e.g., `Grep "hook"` and land on `rules-hooks-agents-md.md`) will read the body and only later (or never) see the bottom-of-file correction.
- **Recommendation:** Either (a) hoist a one-line banner at the top of each old page (“This page is superseded for plugin/hook/subagent schema by `plugin-build-guide.md`; the body remains for context and historical SSOT”), or (b) inline-mark the affected sections with a “SUPERSEDED” note next to each contradicted claim. INDEX.md does call the new guide “SSOT for new plugin/skill construction” (`INDEX.md:63`), which helps but does not protect users who skip the index.

### F4 — Medium — Template `hooks.json` references files that don’t ship in the templates

- **File:** `assets/templates/hooks.json:9, 22, 33, 42, 53`
- **Evidence:** the template references five hook scripts (`session-start.cjs`, `user-prompt.cjs`, `edit-guard.cjs`, `dispatch-guard.cjs`, `completion-check.cjs`) — none of which exist in `assets/templates/`. Only `hook-deny.cjs` is shipped.
- **Risk:** A user copying `hooks.json` into a new plugin will get a config that points at non-existent scripts. Codex will error or silently skip at first invocation. Worse, the user may believe enforcement is happening when nothing is wired.
- **Recommendation:** Either (a) ship stub `.cjs` files alongside (each emitting `{}` to allow), or (b) replace the template with a single hook entry pointing at `hook-deny.cjs` plus a comment block showing how to add more, or (c) add a giant `// EDIT THESE PATHS — these script files do not exist yet` banner in the JSON (JSON has no comments, so this means a header `_comment` field or a sibling `.md` explainer the SKILL.md links to).

### F5 — Medium — Template `subagent.toml` ships a deliberately unset `model` field

- **File:** `assets/templates/subagent.toml:27`
- **Evidence:** `# model = "<verified-model-id>"` (commented). The rationale (“model SKUs rotate”) is documented, which is correct discipline. But a less careful user will uncomment and put a guessed string.
- **Risk:** Low if the user reads the comment. Medium if a downstream tutorial copy-pastes the template into a blog post and the placeholder leaks.
- **Recommendation:** Replace the placeholder with `# model = "gpt-5.1-codex" # VERIFY against https://developers.openai.com/codex/config-reference.md BEFORE shipping`. Anchor verification to a URL.

### F6 — Medium — `hook-deny.cjs` fails OPEN on malformed input

- **File:** `assets/templates/hook-deny.cjs:51-55`
- **Evidence:** `catch { allow(); return; }` with comment “Fail open on malformed input — replace with `deny(...)` if your policy needs fail-closed.”
- **Risk:** This is a template meant to be copy-pasted. The KB itself states (`rules-hooks-agents-md.md:74-80`) “Hook design principles: Fail closed for security and governance enforcement.” The template defaults contradict the principle. A user copying the template for a security guard will inherit fail-open behavior unless they read the inline comment carefully.
- **Recommendation:** Flip the default to fail-closed (`deny("malformed hook input")`) and leave the inline comment saying “Flip to `allow()` if your policy is informational only.” This is safer-by-default. Alternatively, ship two templates: `hook-deny-failclosed.cjs` and `hook-deny-failopen.cjs`.

### F7 — Medium — Hook matcher in template uses `Bash` but Codex tool names are not documented in the templates

- **Files:** `assets/templates/hooks.json:29, 38`; `hook-deny.cjs:9-13, 61`
- **Evidence:** Matchers use `apply_patch|Bash` and `spawn_agent`. `hook-deny.cjs` example wires `"matcher": "Bash"` and the body checks `event.tool_name === 'Bash'`.
- **Risk:** Tool names in Codex have evolved (Claude Code uses `Bash`, OpenAI Codex CLI is documented to use the same name in 2026 per the consolidated guide — but `apply_patch` vs `Edit/Write` differs). If a user matches the wrong name, the hook silently does nothing. There’s no inline reference to which tool names are valid in Codex 2026.
- **Recommendation:** Add a one-block table to `references/hooks-schema.md` (referenced from `SKILL.md` step 6) enumerating the canonical Codex tool names valid in matchers as of `last_verified`, with a “verify against changelog before shipping” note.

### F8 — Low — Cross-runtime physical coupling: skill lives at `~/.claude/skills/` but documents Codex

- **Files:** Skill lives at `C:/Users/win/.claude/skills/codex-plugin-builder/SKILL.md`; KB lives at `D:/Pipeline Orchestrator For Codex/references/openai-codex-kb/`.
- **Evidence:** The skill body and the KB document the same schemas (hooks, subagents, marketplace). They are not symlinked; they are independent copies of overlapping content.
- **Risk:** Drift. When OpenAI changes a Codex schema, somebody must remember to update **both** locations. The new KB carries a `last_verified` field — the skill does not.
- **Recommendation:** Either (a) add a `last_verified` line at the top of `SKILL.md` body (not in frontmatter, since `description` is the only one that triggers selection) so a future reader can see staleness; or (b) make the skill body terse and have each `references/*.md` say “See `<KB-path>` for the canonical schema; this file is a copy snapshotted on YYYY-MM-DD”. Option (b) is heavier but eliminates the drift.

### F9 — Low — `CLAUDE.md` shim is helpful but does not warn agents about the user-global skill at `~/.claude/skills/codex-plugin-builder/`

- **File:** `D:/Pipeline Orchestrator For Codex/CLAUDE.md:11-22`
- **Evidence:** Lists 6 authority sources (AGENTS.md, .kiro/, etc.). Does not mention that a global skill exists that documents the same schemas.
- **Risk:** A Claude Code session opening this repo will not be told that `codex-plugin-builder` skill is available and is the canonical entry for plugin-related questions. The skill itself triggers on description match, so it might fire anyway, but the agent loses the “read the skill first” signal.
- **Recommendation:** Add one line: “For Codex plugin/skill/hook/subagent construction inside this repo, the `codex-plugin-builder` skill is the verified consolidated guide; the KB pages under `references/openai-codex-kb/` are the historical per-topic SSOT.”

### F10 — Low — `marketplace.json` template `description` field is documented as “overrides plugin.json description in the marketplace UI” without source link

- **File:** `assets/templates/marketplace.json:14`
- **Evidence:** “Optional listing description — overrides plugin.json description in the marketplace UI when set.”
- **Risk:** This behavior claim is concrete and falsifiable. If wrong, users will be confused about which description appears in the UI. The KB does not cite a URL for the “overrides” claim.
- **Recommendation:** Cite the OpenAI marketplace docs URL in `references/marketplace.md` and remove the claim from the template comment if it cannot be verified.

### F11 — Info — `SKILL.md` body length

- **File:** `SKILL.md` (181 lines).
- **Evidence:** within the “under ~500 lines” budget the guide itself recommends. Healthy.

### F12 — Info — INDEX.md `last_verified` bumped to 2026-05-19

- **File:** `INDEX.md:38`
- **Evidence:** Consistent with the dated edits in the rest of the KB. The article map entry for `plugin-build-guide.md` (`INDEX.md:63`) is well-phrased and explicitly labels it as the SSOT carrying drift corrections.

---

## What a real 3-scanner consensus would have added (and is missing)

Because only one reviewer ran with full context, the following are **not** in this report:

- **Independent re-derivation of schemas** from the source URLs by a context-blind reviewer (the strongest test of whether the Drift Notes are right or themselves wrong). This is the highest-value missing artifact — finding F2 is essentially a placeholder for it.
- **Cross-scanner triangulation** on the skill description: a quality reviewer running blind would test the description against a representative prompt set and report under/over-trigger rates. Finding F1 is a single-reviewer guess.
- **Adversarial template stress-testing** by a security reviewer simulating copy-paste-into-production: would catch F4/F6/F7 with concrete attacker scenarios (e.g., “user wires deny hook, fails open on garbage input, attacker sends malformed event, deletion proceeds”).
- **Architecture coherence check** across two physical locations: would either confirm F8 is benign or escalate it to High based on a hardcoded drift example.

---

## Consensus / unique / contradictions

Not applicable — only one reviewer ran. Producing fake consensus would invert the contract.

---

## Overall verdict

**DEGRADED — RE-RUN REQUIRED.**

The contracted final adversarial review did not execute. The single-reviewer self-audit above found:

- 0 Critical
- 2 High (F1 description routing, F2 unverified web claims — both contingent on re-verification by a context-blind reviewer)
- 4 Medium (F3 SSOT bleed-through, F4 template references missing files, F5 model placeholder, F6 fail-open template, F7 missing tool-name reference)
- 2 Low (F8 cross-runtime coupling drift, F9 CLAUDE.md doesn’t mention global skill, F10 unverified marketplace claim)
- 2 Info

None are blocking the work as documentation, but the **High** findings (F1, F2) cannot be properly assessed without the missing scanners. Treat this report as input, not as the gate.

---

## Top 5 prioritized recommendations (no fixes proposed; REVIEW-ONLY)

1. **Re-run the final adversarial gate in a session where the three `pipeline-orchestrator:executor:type-specific:adversarial-*` subagents are mounted.** Reuse the file list verbatim. This is the actual contracted output.
2. **Verify every Drift Notes claim against the live OpenAI Codex docs** before publishing the guide as SSOT. Each bullet should link the exact URL section that proves the claim. If any claim cannot be verified, downgrade it to “hypothesis”.
3. **Fix template hazards** (F4, F6, F7): stop referencing scripts that don’t ship; flip the deny-hook default to fail-closed; document canonical Codex tool names next to the matcher examples.
4. **Hoist “superseded” banners** to the top of `plugins.md`, `skills.md`, `agents-and-subagents.md`, `rules-hooks-agents-md.md` (F3) so readers don’t miss the Drift Notes at the bottom.
5. **Decide the skill ↔ KB coupling story** (F8): either snapshot the skill with `last_verified` discipline or make the skill point at the KB as canonical and stop duplicating schemas.

---

## Reviewer integrity notes

- This document was produced with full context (skill body + KB body + templates all read in-thread). It is therefore **not** a context-independent review.
- No web fetches were performed; the “last_verified 2026-05-19” claim in the artifacts is taken at face value but flagged in F2.
- No code was modified. No tests were run (the artifacts are documentation; the repo has no test that targets KB content).
- The skill/KB Drift Notes might be entirely correct — this reviewer simply cannot confirm without the missing independent verification pass.
