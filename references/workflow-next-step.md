# Workflow NEXT_STEP Contract

`src/workflow/next-step.ts` is the source of truth for workflow handoff rules.

Every command or skill workflow must end with a `NEXT_STEP` block. This makes the execution readable and prevents a completed step from leaving the user with an undefined next action.

## Block Shape

```yaml
NEXT_STEP:
  status: passed | blocked | needs-user | skipped
  current_workflow: <workflow-name>
  mode: auto | suggest | blocked | stop
  next_workflow: <workflow-name | none>
  command: <slash-command | none>
  requires_approval: true | false
  reason: <plain-language reason>
```

## Rules

- `passed`: point to the next workflow declared in `WORKFLOW_NEXT_STEPS`.
- `blocked`: point back to the same workflow and state the blocker.
- `needs-user`: point back to the same workflow and ask for the missing decision.
- `skipped`: only use when the skip is explicit and allowed by that workflow.
- `auto`: only when the controller is already running the workflow and the next rule does not require user approval.
- `suggest`: default mode for visible handoff to the user.
- `stop`: use when no next workflow remains.

The block is a contract, not decoration. Do not omit it from final workflow output, even when the next action is `none`.
