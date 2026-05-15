# Workflow Method Gate

This is the SSOT for the first visible checkpoint of every public Pipeline Orchestrator workflow.

Before any execution, dispatch, file edit, report generation, validation claim, or phase transition, the parent Codex context must show the selected workflow/method and wait for an explicit user response.

```yaml
WORKFLOW_METHOD_GATE:
  selected_workflow: "audit | bugfix | feature | ux | spec | brainstorm | review | verify-completion"
  selected_mode: "light | heavy | auto | diagnostic | review-only | hotfix | continue"
  reason: "brief reason derived from the user request"
  alternatives: ["audit", "bugfix", "feature", "ux", "spec", "brainstorm", "review", "verify-completion"]
  question: "Vou rodar como <workflow/mode>. Voce aprova ou quer trocar?"
  wait_for_user: true
```

Accepted user responses:

- `yes`, `sim`, `approve`, `aprovado`: keep the selected workflow.
- `audit`, `bugfix`, `feature`, `ux`, `spec`, `brainstorm`, `review`, `verify-completion`: switch to that workflow and ask again.
- `adjust`, `ajustar`: ask one short clarification question and rebuild the method gate.
- `no`, `nao`, `não`, `cancel`: stop before execution.

For `/pipeline-orchestrator-for-codex:pipeline`, this gate must happen before Phase 0 agent dispatch. The task-orchestrator may later refine classification, but if the refined workflow differs from this approved method, the parent must surface the change and ask again before execution.

`continue` is the only narrow exception: it may resume an already approved workflow, but it must still state the resumed workflow and stop if the existing session has no approval proof.
