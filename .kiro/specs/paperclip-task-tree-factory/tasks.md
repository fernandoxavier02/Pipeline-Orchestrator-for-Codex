# Tasks

**Version:** 0.1.0
**Date:** 2026-06-12
**Status:** approved
**Total tasks:** 6
**Execution rule:** prove existing runtime behavior before claiming this spec closes any Paperclip parity gap.

## Requirement-Task Mapping

| Requirement | Task(s) |
| --- | --- |
| REQ-001 | TASK-001 |
| REQ-002 | TASK-002 |
| REQ-003 | TASK-003 |
| REQ-004 | TASK-003 |
| REQ-005 | TASK-004 |
| REQ-006 | TASK-005, TASK-006 |

## TASK-001: Verify Flow Inventory

_Requirements:_ REQ-001
_Boundary:_ `references/paperclip/spec/lib/tree-template.cjs`, flow inventory tests, docs evidence.

- [ ] 1.1 Verify current flow families and variants against `references/paperclip/PAPERCLIP-FLOW-MIRROR.md`.
- [ ] 1.2 Record compatibility templates separately from canonical flow families.
- [ ] 1.3 Add or update focused tests if a flow family is missing from the measured inventory.

## TASK-002: Verify Dependency Semantics

_Requirements:_ REQ-002
_Boundary:_ `references/paperclip/spec/lib/tree-factory.cjs`, paired tests.

- [ ] 2.1 Verify linear `blockedByIssueIds` behavior.
- [ ] 2.2 Verify fan-in requires every sibling issue id.
- [ ] 2.3 Verify dynamic slice expansion converges correctly for supported feature flows.

## TASK-003: Verify Dry-Run and I/O Safety

_Requirements:_ REQ-003, REQ-004
_Boundary:_ `references/paperclip/spec/lib/tree-factory-io.cjs`, `references/paperclip/spec/lib/grow-tree.cjs`, paired tests.

- [ ] 3.1 Verify dry-run performs zero Paperclip `POST /issues`.
- [ ] 3.2 Verify confirmed runs validate ids and roster lookup before mutation.
- [ ] 3.3 Verify successful API responses without issue ids are rejected.

## TASK-004: Verify Fidelity Measurement Surface

_Requirements:_ REQ-005
_Boundary:_ `references/paperclip/spec/lib/measure-fidelity.cjs`, `skills/measure-paperclip-fidelity/**`, plugin package tests.

- [ ] 4.1 Verify fidelity measurement is read-only.
- [ ] 4.2 Verify public skill text points to the bundled runtime entrypoint.
- [ ] 4.3 Verify package surface includes the fidelity skill and runtime files.

## TASK-005: Maintain Claim Boundary Evidence

_Requirements:_ REQ-006
_Boundary:_ `evals/outputs/latest_output.md`, portability ledger, closeout text.

- [ ] 5.1 Record changed files, tests run, and Eval Gate result for every spec update.
- [ ] 5.2 State explicitly when installed-cache, Marketplace, VPS, or live smoke evidence was not collected.
- [ ] 5.3 Avoid marking this spec as runtime completion unless runtime and package-surface tests support the claim.

## TASK-006: Validate Spec Surface

_Requirements:_ REQ-006
_Boundary:_ `.kiro/specs/paperclip-task-tree-factory/**`, focused tests.

- [ ] 6.1 Verify `spec.json`, `requirements.md`, `design.md`, and `tasks.md` exist.
- [ ] 6.2 Verify the spec names dry-run, fan-in, id validation, fidelity measurement, and claim boundary contracts.
- [ ] 6.3 Run focused tests and Eval Gate before reporting this Wave 6B slice as complete.

## Validation Commands

```bash
npx vitest run tests/unit/paperclip/task-tree-factory-spec.test.ts
python3 .agents/skills/workflow-eval-gate/scripts/run_eval.py --repo-root .
```
