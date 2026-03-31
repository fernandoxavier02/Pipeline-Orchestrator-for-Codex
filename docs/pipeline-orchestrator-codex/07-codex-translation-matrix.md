# Codex Translation Matrix

## Goal

This document translates the Claude-oriented plugin model into Codex-native execution patterns.

The target is functional parity, not mechanical imitation. Where Claude and Codex expose different primitives, the Codex implementation should preserve the operational outcome rather than the literal mechanism.

## Translation Categories

Each capability falls into one of three classes:

### Direct

The capability has a close Codex equivalent and can be implemented with minimal adaptation.

### Adapted

The capability exists conceptually in Codex, but the mechanism is different and requires controller logic.

### Emulated

No first-class Codex primitive matches the Claude behavior. The feature must be simulated through prompt structure, state management, or local tooling.

## Primitive Mapping

| Claude-oriented concept | Codex equivalent | Class | Notes |
| --- | --- | --- | --- |
| slash command `/pipeline` | skill-triggered controller entrypoint or dedicated local plugin command | Adapted | Codex can expose skills and plugin-defined workflows, but the command surface is different. |
| `Task` tool with named subagents | `spawn_agent` with explicit task ownership | Adapted | Very strong match, but Codex requires explicit user permission for subagent use. |
| `TodoWrite` | `update_plan` | Direct | This maps well to visible staged execution. |
| `AskUserQuestion` | assistant question in-thread | Adapted | Codex has no dedicated question tool in default mode; the controller must serialize questions itself. |
| `EnterPlanMode` / `ExitPlanMode` | controller-enforced planning phase plus `update_plan` | Emulated | Codex collaboration modes are not user-switchable from the plugin prompt. |
| hook-based trigger wiring | local plugin integration, wrapper logic, or controller conventions | Adapted | Codex has plugins and skills, but not Claude's exact hook model. |
| markdown agent registry | prompt files plus dispatcher mapping | Direct | The structure can be preserved. |
| structured state files | local JSON/YAML/Markdown state artifacts | Direct | Codex can persist files normally. |
| command resume `/pipeline continue` | resume from persisted state plus controller routing | Adapted | Same outcome, different entry mechanism. |
| final independent review team | multiple `spawn_agent` workers or sequential clean-context reviews | Adapted | True parallelism exists, but explicit delegation rules apply. |

## Command Surface Translation

The Claude plugin exposes one primary command with multiple modes.

Recommended Codex translation:

### Option A: single Codex plugin command

Expose a single command such as:

- `/pipeline`
- `/pipeline diagnostic`
- `/pipeline continue`
- `/pipeline review-only`

This is the closest UX match if building a dedicated Codex plugin.

### Option B: skill plus argument parsing

Expose the pipeline as a skill-driven workflow where the controller prompt parses user intent and optional flags.

This is simpler to prototype but weaker as a productized surface.

### Recommendation

For long-term parity, implement Option A in the future Codex plugin, but use Option B while iterating on behavior and prompts.

## Agent Model Translation

Claude agent prompts map naturally to Codex prompt files plus a dispatcher registry.

Recommended structure:

- `prompts/controller/*.md`
- `prompts/agents/core/*.md`
- `prompts/agents/executor/*.md`
- `prompts/agents/quality/*.md`
- `runtime/dispatcher.ts` or equivalent

The dispatcher should resolve:

- agent name
- allowed scope
- required inputs
- expected structured output block
- whether the agent must run in fresh context

## Named Subagents and Codex Constraints

The strongest Claude-to-Codex difference is delegation policy.

In this Codex environment:

- subagents exist
- but they should only be used when the user explicitly asks for subagents, delegation, or parallel agent work

This means the future Codex port needs two execution modes:

### Full multi-agent mode

Activated when the environment and user permission allow agent delegation.

### Single-agent emulation mode

Activated when delegation is unavailable or disallowed.

In single-agent mode, the controller must simulate role separation by:

1. switching prompts internally
2. clearing or summarizing context between review passes
3. requiring structured outputs from each pass
4. forbidding the "review" pass from silently inheriting implementation assumptions

Functional parity depends on supporting both modes.

## Plan Tracking Translation

Claude `TodoWrite` maps directly to Codex `update_plan`.

Recommended Codex policy:

- create the phase plan after triage
- keep exactly one step in progress
- update the plan at each checkpoint
- persist a file-based mirror when `continue` support is needed across sessions

This gives Codex both conversational visibility and durable runtime state.

## Question and Approval Translation

The Claude plugin relies on proposal confirmation and targeted follow-up questions.

Recommended Codex behavior:

- always show a proposal before major execution
- ask one blocking question at a time
- explicitly label what decision is needed
- persist the answer in runtime state

The missing primitive is not a blocker. It simply means the controller must own the questioning discipline.

## Hook Translation

Claude hooks appear in `hooks/hooks.json`.

In Codex, equivalent behavior may be split across:

- plugin command wrappers
- controller startup logic
- pre-dispatch validation
- post-step persistence
- final closeout logic

Recommended mapping:

| Claude hook intent | Codex translation |
| --- | --- |
| start-of-run initialization | controller bootstrap |
| pre-execution checks | gate manager preflight |
| post-phase persistence | state writer after each phase |
| completion summary | closeout renderer |

The principle is more important than the exact plumbing.

## State Persistence Translation

The plugin's `continue` mode implies persistent state.

Recommended Codex runtime files:

- `.codex/pipeline/session.json`
- `.codex/pipeline/proposal.md`
- `.codex/pipeline/plan.md`
- `.codex/pipeline/gate-decisions.jsonl`
- `.codex/pipeline/confidence-score.yaml`
- `.codex/pipeline/checkpoints/`

These paths can vary, but the persisted concepts should remain stable.

## Review Independence Translation

Claude achieves independence largely through separate agents and context boundaries.

Codex should preserve the same effect by choosing one of two patterns:

### When subagents are allowed

- use distinct review agents with narrow prompts
- avoid passing implementation rationale beyond what the reviewer needs
- provide changed files and objective requirements only

### When subagents are not allowed

- summarize the implementation neutrally
- re-open only the relevant files
- run a review prompt that explicitly distrusts prior conclusions
- require findings with evidence

The key parity target is independence of judgment, not the exact infrastructure.

## Mode Translation

The Claude modes should map to Codex runtime profiles:

| Mode | Codex behavior |
| --- | --- |
| `full` | normal phased execution |
| `diagnostic` | classify, inspect, propose, persist no changes |
| `continue` | reload state and resume from last safe checkpoint |
| `review-only` | run review/validation layers against existing code |
| `--plan` | deepen phase 1.5 and require richer plan output |
| `--grill` | increase adversarial review intensity and maybe lower acceptance threshold |
| `--hotfix` | compress planning and reduce ceremony while preserving verification |
| `--simples` / `--media` / `--complexa` | override or bias complexity routing |

## Filesystem and Packaging Translation

Claude plugin packaging:

- `.claude-plugin/plugin.json`
- command markdown
- hooks config
- agent markdown

Recommended Codex packaging:

- `.codex-plugin/plugin.json`
- `skills/` or `commands/` entrypoints
- `prompts/` registry
- `runtime/` implementation code
- `docs/` operator documentation

This is a packaging translation, not a behavioral change.

## What Must Not Be Lost

When porting to Codex, these outcomes matter more than literal syntax:

1. staged execution with explicit proposals
2. gate-based movement through phases
3. structured planning before heavy implementation
4. batched execution with review/fix loops
5. independent adversarial review
6. persistent resumability
7. evidence-based final go/no-go

If those survive, the Codex version will preserve the essence of the original plugin.
