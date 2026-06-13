# Claude to Codex Paperclip Migration Guide

This guide explains the Codex adaptation of the Paperclip workflow surface. It is repo-only evidence for PIP-70 Wave 6B and does not prove Marketplace publication, installed Codex cache activation, VPS dispatch, or live plugin execution.

## Migration Boundary

The canonical Claude workflow assumes Claude-style task tools and subagent dispatch. This Codex repo preserves the workflow shape through Codex plugin surfaces:

- `commands/paperclip-*.md` files are discovery and compatibility shims; executable public Codex behavior is proven through `skills/paperclip-*/SKILL.md`, manifest/package evidence, installed-cache proof, and smoke evidence at the layer being claimed.
- Paperclip flow templates and fidelity helpers live under `references/paperclip/**`.
- Runtime-backed pipeline behavior remains owned by `skills/pipeline/SKILL.md`, `commands/pipeline.md`, `src/**`, `hooks/**`, and tests.
- Real multi-agent execution is valid only when `spawn_agent`, `wait_agent`, artifact collection, gate recording, hook/checkpoint recording, and structured final state are available.

If those runtime capabilities are unavailable, governed pipeline paths must stop with `blocked-no-agent-runtime`. Manual or local harness evidence can help diagnose behavior, but it is not a valid production multi-agent pipeline execution.

## Porting Checklist

1. Map the Claude workflow type to a Codex Paperclip skill.
2. Keep `commands/**` short and discoverable; place operational detail in `skills/**`, `references/**`, runtime code, hooks, and tests.
3. Replace Claude-native task assumptions with Codex protocol blocks or explicit `blocked-no-agent-runtime` behavior.
4. Add repo tests for command/skill existence, classifier routing, flow-template mapping, or documentation surface coverage.
5. Record the claim boundary in `docs/PORTABILITY_CLOSEOUT_V7_12.md` before marking a gap closed.

## Workflow Mapping

| Canonical intent | Codex command | Codex skill | Current proof layer |
| --- | --- | --- | --- |
| Audit | `commands/paperclip-audit.md` | `skills/paperclip-audit/SKILL.md` | repo fixtures and flow templates |
| Bug fix | `commands/paperclip-bugfix.md` | `skills/paperclip-bugfix/SKILL.md` | repo fixtures and flow templates |
| Feature or user story | `commands/paperclip-feature.md`, `commands/paperclip-user-story.md` | `skills/paperclip-feature/SKILL.md`, `skills/paperclip-user-story/SKILL.md` | repo fixtures, BDD parity, and flow templates |
| Hotfix | `commands/paperclip-hotfix.md` | `skills/paperclip-hotfix/SKILL.md` | repo fixtures and hotfix tests |
| Spec | `commands/paperclip-spec.md` | `skills/paperclip-spec/SKILL.md` | repo fixtures and `.kiro/specs/paperclip-task-tree-factory/**` |
| UX simulation | `commands/paperclip-ux.md` | `skills/paperclip-ux/SKILL.md` | repo fixtures and flow templates |

## What Not To Claim

Do not describe this repo state as published, installed, active in a user cache, or live-smoked unless that layer has separate evidence. A passing local test proves the checkout, not Marketplace or runtime activation.
