---
name: validate-design
description: Interactive technical design quality review and validation. Use when reviewing design before implementation.
allowed-tools: spawn_agent
argument-hint: <feature-name>
metadata:
  shared-rules: "design-review.md"
disable-model-invocation: true
gates_at: [phase-1]
sentinel_checkpoints: [post_orchestrator]
---

# validate-design

## VISIBLE_PLAN Contract

As the first assistant action for this workflow, call `update_plan` so the Codex UI opens the visible planning panel before any workflow/method gate, execution, file edit, dispatch, report generation, validation claim, terminal response, or phase transition. This is mandatory for this workflow and uses `references/visible-plan-contract.md` as the SSOT.

The visible plan must name the selected workflow/mode, declare the planned batches, and track PDD, DDD, ATDD, and TDD or the report-only evidence-first equivalent. Every batch must be followed by checkpoint validation, adversarial review, and a fix loop capped at 3 attempts before continuing. Keep exactly one item `in_progress` and update the plan after every gate, batch, review, correction, and final validation. If the visible plan cannot be opened or updated, stop and surface the blocker instead of proceeding invisibly.

## WORKFLOW_METHOD_GATE Contract

Before any execution, dispatch, file edit, report generation, validation claim, terminal response, or phase transition, show the workflow/method gate defined in `references/workflow-method-gate.md` and wait for the user's answer. State the selected workflow/mode, give the practical reason, and allow switching to `audit`, `bugfix`, `feature`, `ux`, `spec`, `brainstorm`, `review`, or `verify-completion` before continuing.

If the user switches workflow, rebuild the gate and ask again. If the gate cannot be shown or the user does not approve, stop before starting the workflow.

## NEXT_STEP Contract

When this workflow reaches any terminal state, emit the `NEXT_STEP` block defined in `references/workflow-next-step.md`. Use the workflow name from this file's frontmatter as `current_workflow`; if blocked or waiting on the user, point back to the same workflow instead of advancing.


## Codex Real-Agent Runtime Contract

Any operational path in this workflow that dispatches pipeline work MUST use real Codex `spawn_agent` with a `PIPELINE_AGENT_FQN` marker. If `spawn_agent` is unavailable, fails, or cannot return an isolated agent result, stop with `blocked-no-agent-runtime`. Do not continue inline, do not simulate subagents, and do not report the run as real multi-agent execution.

For informational-only workflows, do not launch the recommended workflow from the help/router context. Recommend the command and stop unless the user explicitly invokes an executable workflow with real agent support.

## Role
You are a specialized skill for conducting interactive quality review of technical design to ensure readiness for implementation.

## Core Mission
- **Mission**: Conduct interactive quality review of technical design to ensure readiness for implementation
- **Success Criteria**:
  - Critical issues identified (maximum 3 most important concerns)
  - Balanced assessment with strengths recognized
  - Clear GO/NO-GO decision with rationale
  - Actionable feedback for improvements if needed

## Execution Steps

### Step 1: Gather Context

If steering/spec context is already available from conversation, skip redundant file reads.
Otherwise, load all necessary context:
- Read `pipeline-runs/<run_id>/01-spec/spec.json` for language and metadata
- Read `pipeline-runs/<run_id>/01-spec/requirements.md` for requirements
- Read `pipeline-runs/<run_id>/01-spec/design.md` for design document
- Core steering context: `product.md`, `tech.md`, `structure.md`
- Additional steering files only when directly relevant to architecture boundaries, integrations, runtime prerequisites, domain rules, security/performance constraints, or team conventions that affect implementation readiness
- Relevant local agent skills or playbooks only when they clearly match the feature's host environment or use case and provide review-relevant context

#### Parallel Research

The following research areas are independent and can be executed in parallel:
1. **Context & rules loading**: Spec documents, core steering, task-relevant extra steering, relevant local agent skills/playbooks, and `rules/design-review.md` from this skill's directory for review criteria
2. **Codebase pattern survey**: Gather existing architecture patterns, naming conventions, and component structure from the codebase to use as reference during review

After all parallel research completes, synthesize findings for review.

### Step 2: Execute Design Review
- Reference conversation history: leverage prior requirements discussion and user's stated design intent
- Follow design-review.md process: Analysis → Critical Issues → Strengths → GO/NO-GO
- Limit to 3 most important concerns
- Engage interactively with user — ask clarifying questions, propose alternatives
- Use language specified in spec.json for output

### Step 3: Decision and Next Steps
- Clear GO/NO-GO decision with rationale
- Provide specific actionable next steps (see Next Phase below)

## Important Constraints
- **Quality assurance, not perfection seeking**: Accept acceptable risk
- **Critical focus only**: Maximum 3 issues, only those significantly impacting success
- **Conversation-aware**: Leverage discussion history for requirements context and user intent
- **Interactive approach**: Engage in dialogue, ask clarifying questions, propose alternatives
- **Balanced assessment**: Recognize both strengths and weaknesses
- **Actionable feedback**: All suggestions must be implementable
- **Context Discipline**: Start with core steering and expand only with review-relevant steering or use-case-aligned local agent skills/playbooks

## Tool Guidance
- **Read first**: Load spec, core steering, relevant local playbooks/agent skills, and rules before review
- **Grep if needed**: Search codebase for pattern validation or integration checks
- **Interactive**: Engage with user throughout the review process

## Output Description
Provide output in the language specified in spec.json with:

1. **Review Summary**: Brief overview (2-3 sentences) of design quality and readiness
2. **Critical Issues**: Maximum 3, following design-review.md format
3. **Design Strengths**: 1-2 positive aspects
4. **Final Assessment**: GO/NO-GO decision with rationale and next steps

**Format Requirements**:
- Use Markdown headings for clarity
- Follow design-review.md output format
- Keep summary concise

## Safety & Fallback

### Error Scenarios
- **Missing Design**: If design.md doesn't exist, stop with message: "Run `/pipeline-orchestrator-for-codex:spec-design {feature}` first to generate design document"
- **Design Not Generated**: If design phase not marked as generated in spec.json, warn but proceed with review
- **Empty Steering Directory**: Warn user that project context is missing and may affect review quality
- **Language Undefined**: Default to English (`en`) if spec.json doesn't specify language

### Next Phase: Task Generation

**If Design Passes Validation (GO Decision)**:
- Apply any suggested improvements if agreed
- Run `/pipeline-orchestrator-for-codex:spec-tasks {feature}` to generate implementation tasks
- Or `/pipeline-orchestrator-for-codex:spec-tasks {feature} -y` to auto-approve and proceed directly

**If Design Needs Revision (NO-GO Decision)**:
- Address critical issues identified in review
- Re-run `/pipeline-orchestrator-for-codex:spec-design {feature}` with improvements
- Re-validate with `/pipeline-orchestrator-for-codex:validate-design {feature}`

**Note**: Design validation is recommended but optional. Quality review helps catch issues early.
