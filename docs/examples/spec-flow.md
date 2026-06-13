# Paperclip Spec Flow Example

This example shows the repo-level shape of a Paperclip spec request in Codex. It is documentation evidence for Wave 6B, not a live workflow trace.

## Request

```text
Produce a spec bundle for Paperclip task tree factory governance.
```

## Expected Repo Surfaces

- Command: `commands/paperclip-spec.md`
- Skill: `skills/paperclip-spec/SKILL.md`
- Template family: `spec`
- Spec bundle: `.kiro/specs/paperclip-task-tree-factory/**`
- Guard test: `tests/unit/paperclip/task-tree-factory-spec.test.ts`

## Expected Boundary

The spec flow produces or validates structured spec artifacts. It must keep requirements, design, tasks, and `spec.json` aligned, and it must not mark implementation complete unless post-implementation validation evidence exists.
