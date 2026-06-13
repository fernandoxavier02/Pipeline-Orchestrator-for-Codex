# Paperclip Runtime Surfaces

This diagram records the Codex adaptation boundary for Paperclip. It is a repo documentation artifact, not proof that the plugin is installed or active.

```mermaid
flowchart TD
    User["User request"] --> Command["commands/paperclip-*.md"]
    Command --> Skill["skills/paperclip-*/SKILL.md"]
    Skill --> RuntimeGate{"Real Codex agent runtime available?"}
    RuntimeGate -->|yes| Pipeline["skills/pipeline/SKILL.md and controller runtime"]
    RuntimeGate -->|no| Blocked["blocked-no-agent-runtime"]
    Pipeline --> Src["src/** runtime contracts"]
    Pipeline --> Hooks["hooks/** and .codex/hooks/** evidence"]
    Skill --> Refs["references/paperclip/** templates and fidelity helpers"]
    Refs --> Tests["tests/compat/**, tests/bdd/**, tests/regression/**"]
    Src --> Tests
    Hooks --> Eval["Eval Gate and telemetry"]
    Tests --> Closeout["docs/PORTABILITY_CLOSEOUT_V7_12.md"]
    Eval --> Closeout
```

## Surface Ownership

| Surface | Owns | Does not prove |
| --- | --- | --- |
| `commands/paperclip-*.md` | public discovery text | runtime execution by itself |
| `skills/paperclip-*/SKILL.md` | workflow-specific operating contract | installed-cache activation |
| `references/paperclip/**` | canonical Paperclip reference material and template helpers | live board behavior |
| `src/**` and `hooks/**` | runtime and enforcement behavior | Marketplace publication |
| `tests/**` | repo-level regression and compatibility evidence | VPS dispatch or live plugin smoke |
| `evals/**` | local Eval Gate and telemetry evidence | global Codex hook activation |

## Claim Boundary

The closeout ledger must name the evidence layer. Repo-only documentation, diagrams, examples, and tests can close local Wave 6B documentation gaps, but public portability claims still require package-surface proof and installed-cache smoke proof.
