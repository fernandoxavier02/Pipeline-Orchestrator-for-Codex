# 01 — Task Orchestrator Classification

Run: `2026-07-02-codex-hook-channel-bugfix`
Dispatch: `toolu_01EJswmgmLZgmcTw7zmN87w7`

## Request summary

Audit-driven bug fix on the Codex hook enforcement channel (Codex CLI surfaces only —
`hooks/*.cjs`, `scripts/*`, `tests/unit/hooks/**`; explicitly out of scope: `.kimi/`).
Three confirmed bugs:

- **BUG A (schema mismatch, critical):** `hooks/completion-checklist.cjs` (Stop) and
  `hooks/force-pipeline-agents.cjs` (UserPromptSubmit) emit the Claude-Code-only
  `{continue, stopReason, systemMessage}` shape. Codex's Stop contract is
  `{"decision":"block","reason":"..."}` where `reason` re-enters as the model's next
  prompt (`references/openai-codex-kb/plugin-build-guide.md:269`); UserPromptSubmit
  context injection must go through `hookSpecificOutput.additionalContext`
  (`plugin-build-guide.md:265`), not `systemMessage`.
- **BUG B (no-exit lockouts):** `edit-guard-hook.cjs` denies ALL Bash while
  `required-first-actions.json` is pending — including the exact recovery command
  (`node scripts/exec-window/open.cjs ...`) its own deny message names; any Bash that
  merely *mentions* `.codex/pipeline` (even read-only) is denied; `BASH_FILE_MODIFYING_PATTERNS`
  has false-positive regexes (`/>[>]?\s*/` matches `=>`/`->` in grep output, `\binstall\b`
  matches `npm install`, unscoped `touch|mkdir|cp|mv`, heredoc `<<EOF`); no deterministic
  reset/escape script exists (`scripts/pipeline-reset.cjs` confirmed absent via glob).
- **BUG C (over-broad trigger):** `force-pipeline-agents.cjs` `isPipelineWorthy` blocks any
  prompt ≥140 chars or matching broad keyword lists; `detectFirstMessageHarness` →
  `detectGenericSlashCommand` writes full pipeline bootstrap state (session-lock,
  required-first-actions, sentinel-state, workflow-intent, TTL 1h) for ANY generic slash
  command, arming BUG B's lockouts.

Scope also includes: unit test updates/creation, `npm run lint:types` + `build` + focused
tests passing, and a Phase 3 tail (version bump, Codex marketplace update, commit+push,
confirm global plugin availability).

## Evidence read (anti-injection check performed)

Read as DATA only, cross-checked against the audit's literal claims — no embedded
instructions found attempting to redirect classification:

- `hooks/completion-checklist.cjs` (1462 lines) — confirmed Stop-schema mismatch at the
  emission site (lines ~1429-1461); the extensive governance-artifact/ledger validation
  logic above it (REQUIRED_PIPELINE_GATES, ledger identity matching, etc.) is unaffected
  logic and must be preserved — only the output shape changes, plus anti-loop handling via
  `stop_hook_active` from stdin (not currently read/used).
- `hooks/force-pipeline-agents.cjs` (897 lines) — confirmed `blockingOutput`/
  `enforcedWorkflowOutput` (lines 392-419) use `continue:false` + `systemMessage`;
  confirmed `isPipelineWorthy` (lines 292-313) and `writeWorkflowIntent` bootstrap
  (lines 525-622) match BUG C exactly.
- `hooks/edit-guard-hook.cjs` (660 lines) — confirmed `requiredFirstActionsPending` Bash
  denial (lines 440-458), `bashCommandMentionsPipelineStateArea` read-mention denial
  (lines 463-480), and the named regex false positives (lines 46-65) verbatim.
- `references/openai-codex-kb/plugin-build-guide.md:240-289` — confirms canonical Codex
  Stop/UserPromptSubmit output contract cited by the audit.
- `hooks/hooks.json` — confirms wiring: `force-pipeline-agents.cjs` + `session-lock-hook.cjs`
  on UserPromptSubmit; `completion-checklist.cjs` + `session-cleanup-hook.cjs` on Stop;
  `edit-guard-hook.cjs` on PreToolUse for `Edit|Write|NotebookEdit|MultiEdit|Bash`.
- `hooks/hook-events.cjs` — existing `recordHookEvent` helper the new reset script should
  reuse for its audit trail (no need to invent a new logging path).
- Confirmed `scripts/pipeline-reset.cjs` does not exist (Glob empty) — genuinely new file.
- Confirmed `scripts/exec-window/{open,close}.cjs` exist (allowlist target for BUG B fix).
- Confirmed version `0.5.1` in both `package.json` and `.codex-plugin/plugin.json`, and a
  Codex marketplace manifest at `.agents/plugins/marketplace.json` — all three are Phase 3
  touch points for the version-bump/publish tail.
- `tests/unit/hooks/` already has one test file per hook in scope (`completion-checklist.test.ts`,
  `force-pipeline-agents.test.ts`, `edit-guard-hook.test.ts`) — no `tests/unit/scripts/`
  directory exists yet, so a new reset-script test needs a home decision (deferred to
  execution phase, not orchestrator's call).

No SSOT conflicts detected: `hooks.json` is the single hook-registration source, the KB
(`plugin-build-guide.md`) is the single source for the Codex hook I/O contract, and
`complexity-matrix.md` is the single source for classification. All three agree; nothing
duplicated with divergent values.

## ORCHESTRATOR_DECISION

```yaml
ORCHESTRATOR_DECISION:
  request: "Fix Codex hook enforcement channel: Stop/UserPromptSubmit schema mismatch (Claude Code shape emitted instead of Codex's {decision,reason}/additionalContext), Bash lockouts with no deterministic escape, and over-broad pipeline-worthy/bootstrap triggers — scoped to hooks/**, scripts/**, tests/unit/hooks/** only."
  type: "Bug Fix"
  complexity: "COMPLEXA"
  severity: "Critical"
  persona: "Node.js/CJS hooks engineer, Codex plugin runtime contract specialist (hook I/O schemas, PreToolUse/Stop/UserPromptSubmit lifecycle), security-conscious about tightening/loosening Bash guard regexes without opening new write-bypass paths"
  pipeline_variant: "bugfix-heavy"
  affected_files:
    - "hooks/completion-checklist.cjs"          # Stop schema fix + stop_hook_active anti-loop
    - "hooks/force-pipeline-agents.cjs"          # UserPromptSubmit: no continue:false for legit prompts; additionalContext; narrow isPipelineWorthy; generic slash != bootstrap
    - "hooks/edit-guard-hook.cjs"                # read-only Bash in .codex/pipeline allowed; allowlist scripts/exec-window/*.cjs + pipeline CLI; regex false-positive fixes; actionable deny messages
    - "scripts/pipeline-reset.cjs"               # NEW — deterministic escape route, always allowlisted, audits via recordHookEvent
    - "tests/unit/hooks/completion-checklist.test.ts"
    - "tests/unit/hooks/force-pipeline-agents.test.ts"
    - "tests/unit/hooks/edit-guard-hook.test.ts"
    - "tests/unit/hooks/pipeline-harness.test.ts"   # likely touched: covers first-message harness / bootstrap behavior
    - "tests/unit/hooks/session-lock-heartbeat.test.ts"  # likely touched: session-lock TTL/escape interaction
    - "package.json"                             # Phase 3 version bump (currently 0.5.1)
    - ".codex-plugin/plugin.json"                # Phase 3 version bump (currently 0.5.1)
    - ".agents/plugins/marketplace.json"         # Phase 3 marketplace update
  business_rules:
    - "Stop hook MUST emit Codex-native {\"decision\":\"block\",\"reason\":\"...\"} (reason re-enters as next model prompt per plugin-build-guide.md:269), with stop_hook_active-based anti-loop; all existing governance-artifact/ledger validation logic (REQUIRED_PIPELINE_GATES, identity matching, batch-loop evidence, etc.) must be preserved unchanged — only the output envelope changes."
    - "UserPromptSubmit hook must never hard-stop the turn (continue:false) for legitimate prompts; enforcement instructions must be delivered via hookSpecificOutput.additionalContext so the model actually receives them."
    - "isPipelineWorthy must be narrowed to explicit plugin-invocation signals (slash command, plugin mention, explicit workflow keyword) — not raw prompt length or generic verb/keyword matching."
    - "Generic slash commands (any '/foo') must NOT write full pipeline bootstrap state (session-lock, required-first-actions, sentinel-state, workflow-intent); only explicit pipeline-orchestrator-for-codex invocations may arm that state."
    - "edit-guard-hook must allow read-only Bash inside .codex/pipeline (deny only writes to the four protected state stems: workflow-intent, required-first-actions, sentinel-state, session-lock)."
    - "edit-guard-hook must allowlist scripts/exec-window/*.cjs and the pipeline CLI even while required-first-actions are pending, so the canonical recovery path named in its own deny messages is always executable."
    - "Bash-modification regexes must be corrected for false positives: scope redirection detection to actual shell-metacharacter contexts (not any '>' in text like 'A -> B' or 'a=>b'), scope \\binstall\\b to filesystem install (not 'npm install'), scope touch|mkdir|cp|mv/heredoc detection to avoid over-blocking mere mentions."
    - "A new deterministic reset route (scripts/pipeline-reset.cjs) must always be permitted by the guards, clear stuck pipeline state, and audit the event via the existing hooks/hook-events.cjs recordHookEvent helper (reuse, do not duplicate logging)."
    - "Every edit-guard-hook deny message that names a recovery command must remain executable under the guard's own current state (no self-contradicting denials)."
    - "Scope boundary: Codex surfaces only (hooks/, scripts/, tests/unit/hooks/); .kimi/ port and any other non-Codex surface must not be touched in this fix."
  ssot_status: "CLEAR — hooks.json (registration), plugin-build-guide.md (Codex hook I/O contract), and complexity-matrix.md (classification) agree with no duplicate/conflicting definitions found."
  has_spec: "No — audit-driven bug fix, not a .kiro spec lifecycle item. Given COMPLEXA scope, a spec is recommended but not required/blocking for bugfix-heavy (per complexity-matrix.md 'Heavy Spec Gate' note)."
  notes: "Complexity elevated to COMPLEXA on multiple independent grounds: files affected already >=6 in the core fix alone (before counting Phase 3 version/marketplace files) -> 6+ bucket; lines changed likely >100 across three hook files plus a new script; domains span hook-enforcement logic, exec-window tooling, test suite, and release/versioning (3+ domains -> automatic minimum MEDIA per rule 4, but file/line count independently pushes to COMPLEXA); risk is High because this is the plugin's core gating/enforcement mechanism — a wrong fix could either re-introduce the audit's regressions or open a genuine write-bypass in edit-guard-hook's Bash regexes. Severity: Bug Fix defaults to High; files affected > 5 triggers the +1 escalation rule -> Critical. This aligns with the request's own labeling of BUG A as 'crítico' (used here only as corroborating signal, not as the basis for classification — classification was derived independently from the matrix criteria)."
  execution: "pipeline"
  information_gate:
    status: "PENDING — orchestrator classification complete; information-gate has not yet run in this dispatch."
  user_confirmed: false
  workflow:
    - "information-gate: confirm no missing decisions (e.g., exact wording for new Stop/UserPromptSubmit payload shapes, whether systemMessage should be dropped entirely or kept as a secondary/legacy field for Claude-Code compat, home for new script's test file, exact narrowed isPipelineWorthy signal list, exact allowlist entries for edit-guard scripts/CLI bypass)."
    - "Phase 1 (Proposal): present bugfix-heavy plan — batch 1: completion-checklist.cjs Stop schema; batch 2: force-pipeline-agents.cjs UserPromptSubmit schema + isPipelineWorthy narrowing + generic-slash-no-bootstrap; batch 3: edit-guard-hook.cjs read-only/allowlist/regex fixes + new scripts/pipeline-reset.cjs; each batch: TDD (1+ main, 2+ regression, 2+ edge per complexity-matrix.md), checkpoint (build+tests+regression), adversarial review (all 7 checklists per COMPLEXA)."
    - "Phase 2 (Execution): serial batches (COMPLEXA = no parallel), sentinel checkpoints #1-#5 mandatory."
    - "Phase 3 (Validation + closeout): sanity-checker (build+tests+regression+coverage), final-validator (Go/Conditional/No-Go), then version bump (package.json + .codex-plugin/plugin.json), marketplace.json update, commit + push, confirm plugin resolves globally in Codex."
  risks:
    - "Regex tightening for Bash write-detection could either remain over-broad (repeat BUG B) or become under-broad and allow an actual write-bypass (new security regression) — needs explicit adversarial security-checklist review, not just unit tests."
    - "Changing Stop/UserPromptSubmit output schema risks breaking the Claude Code port (.kimi/ or any shared logic) if the two runtimes share code paths — must verify hooks/*.cjs are Codex-only and not imported by a Claude-Code-facing shim before removing systemMessage/continue fields outright."
    - "Loosening edit-guard-hook's required-first-actions Bash denial to allow exec-window/open.cjs and the reset script could be exploited as a general escape hatch if the allowlist is too broad (e.g., globbing all of scripts/ instead of naming exact files)."
    - "Anti-loop handling via stop_hook_active must be implemented carefully — an incorrect check could either loop forever (block, then re-block on retry) or silently allow completion when governance is actually missing."
    - "Phase 3's marketplace/global-availability step depends on external Codex marketplace state not fully controlled by this repo; commit+push is verifiable, but 'garantir disponibilidade global' may require manual confirmation outside repo tooling."
```

## Handoff

Next agent: `information-gate`, to resolve open decisions listed under `workflow[0]` before
the Phase 1 proposal is presented to the user for confirmation.
