# Gate Registry

This file is the repo-local gate inventory for the Codex runtime. It records
the gates currently implemented by `src/gates/gate-registry.ts`; it is not a
claim that every canonical gate already has an end-to-end runtime emitter.

## Inventory

| Gate | Hardness | Phase | Default Decision | Rollback |
| --- | --- | --- | --- | --- |
| `ADVERSARIAL_BLOCK` | `HARD` | `phase-2` | `block` | `revalidate` |
| `ADVERSARIAL_GATE` | `SOFT` | `phase-2` | `skip` | `none` |
| `ADVERSARIAL_GATE_MANDATORY` | `MANDATORY` | `phase-2` | `block` | `manual` |
| `ADVERSARIAL_LOOP_CHECKPOINT` | `SOFT` | `phase-2` | `pass` | `none` |
| `BOOTSTRAP_EXEMPTION_USED` | `AUDIT` | `phase-1` | `pass` | `none` |
| `BYPASS_MODE_ACTIVE` | `MANDATORY` | `phase-0` | `block` | `manual` |
| `CAPABILITY_GATE` | `MANDATORY` | `phase-0` | `block` | `manual` |
| `CHECKPOINT_FAIL` | `HARD` | `phase-2` | `block` | `revalidate` |
| `CLOSEOUT_CONFIRM` | `SOFT` | `phase-3` | `skip` | `none` |
| `COMPLEXITY_GATE` | `SOFT` | `phase-0` | `partial` | `none` |
| `DESIGN_INTERROGATION` | `SOFT` | `phase-0` | `partial` | `none` |
| `EVIDENCE_GATE` | `MANDATORY` | `phase-2` | `block` | `revalidate` |
| `FINAL_ADVERSARIAL_GATE` | `SOFT` | `phase-3` | `skip` | `none` |
| `FINAL_ADVERSARIAL_REWORK` | `HARD` | `phase-3` | `block` | `replan` |
| `FINAL_VERDICT_GATE` | `MANDATORY` | `phase-3` | `block` | `manual` |
| `FIX_LOOP_EXHAUSTED` | `CIRCUIT_BREAKER` | `phase-2` | `block` | `stop` |
| `INFO_GATE_BLOCKED` | `HARD` | `phase-0` | `block` | `revalidate` |
| `INFO_GATE_OK` | `SOFT` | `phase-0` | `pass` | `none` |
| `INTAKE_GATE` | `MANDATORY` | `phase-0` | `block` | `manual` |
| `MICRO_GATE_GAP` | `HARD` | `phase-2` | `block` | `revalidate` |
| `PLAN_GATE_ACTIVE` | `HARD` | `phase-1.5` | `block` | `replan` |
| `PLAN_REJECTED` | `HARD` | `phase-1.5` | `block` | `replan` |
| `REDUCED_VALIDATION_USAGE` | `SOFT` | `phase-3` | `pass` | `none` |
| `SCOPE_GATE` | `MANDATORY` | `phase-1` | `block` | `replan` |
| `SENTINEL_CHECKPOINT` | `HARD` | `phase-0` | `pass` | `none` |
| `SENTINEL_SEQUENCE_BLOCK` | `HARD` | `phase-1` | `block` | `revalidate` |
| `SPEC_AC_TRACEABILITY_GAP` | `HARD` | `phase-2` | `block` | `revalidate` |
| `SPEC_ARTIFACT_MISSING` | `HARD` | `phase-1` | `block` | `replan` |
| `SPEC_CONTENT_REVIEW_NOGO` | `HARD` | `phase-2` | `block` | `replan` |
| `SPEC_FORMAT_GATE_FAIL` | `HARD` | `phase-1` | `block` | `revalidate` |
| `SPEC_POST_IMPL_FAIL` | `HARD` | `phase-3` | `block` | `replan` |
| `SSOT_CONFLICT` | `MANDATORY` | `phase-0` | `block` | `manual` |
| `STALE_CONTEXT` | `SOFT` | `continue` | `skip` | `revalidate` |
| `STEP_1_7_RECURSION_GUARD` | `CIRCUIT_BREAKER` | `phase-1` | `block` | `stop` |
| `STEP_1_7_ROUTING` | `HARD` | `phase-1` | `pass` | `none` |
| `STOP_BEFORE_PA_DE_CAL` | `HARD` | `phase-3` | `block` | `revalidate` |
| `STOP_RULE` | `CIRCUIT_BREAKER` | `phase-2` | `block` | `stop` |
| `TDD_APPROVAL` | `HARD` | `phase-2` | `block` | `revalidate` |

## Wave 1 Delta

- Implemented local inventory: `37` gates.
- Canonical target from `.kiro/specs/canonical-v7-portability-closeout`: `35` gates or documented Codex-specific equivalents.
- Wave 1 registry compatibility: the runtime registry now exposes the named canonical-era delta gates plus Codex-specific extensions.
- Remaining Wave 1 work: prove or document the runtime emitters for the compatibility gates that were added only as registry rows in this slice.

## Canonical Delta Notes

The strongest gate reference currently available in this checkout is split
across:

- the live Codex runtime registry in `src/gates/gate-registry.ts`
- the older Kimi-era reference at `.kimi/skills/pipeline/references/gates.md`
- canonical-closeout evidence under `.kiro/specs/canonical-v7-portability-closeout/**`

That evidence is enough to document the compatibility decision, but not enough
to prove every added row has an end-to-end runtime emitter. The older reference
names four gate concepts now represented as first-class runtime rows:

| Canonical gate concept | Evidence found | Current Codex-equivalent state |
| --- | --- | --- |
| `COMPLEXITY_GATE` | `.kimi/skills/pipeline/references/gates.md`; `references/paperclip/spec/lib/mirror-fidelity-dictionary.cjs` | Added as a `SOFT` `phase-0` registry row. Runtime emission is proven in `tests/unit/controller/pipeline-controller.test.ts`. |
| `STEP_1_7_ROUTING` | `.kimi/skills/pipeline/references/gates.md`; `.kiro/specs/pipeline-meta-ifrs16-modalities-audit/**` | Added as a `HARD` `phase-1` registry row. Runtime route-selection emission is proven in `tests/unit/controller/pipeline-controller.test.ts`. |
| `STEP_1_7_RECURSION_GUARD` | `.kimi/skills/pipeline/references/gates.md` | Added as a `CIRCUIT_BREAKER` `phase-1` registry row. Runtime enforcement for recursive continue during pending proposal confirmation is proven in `tests/unit/controller/pipeline-controller.test.ts`. |
| `STOP_BEFORE_PA_DE_CAL` | `.kimi/skills/pipeline/references/gates.md` | Added as a `HARD` `phase-3` registry row. Runtime emission before PA_DE_CAL on closeout `NO-GO` is proven in `tests/integration/closeout/closeout-confirm.test.ts`. |

Wave 1 can therefore prove this gate-inventory statement at repo level:

- the Codex runtime inventory is stable at `37` rows and test-enforced;
- the named canonical-era delta gates are represented as first-class runtime
  rows by name;
- future work must still prove the corresponding runtime emitters before
  claiming end-to-end behavioral parity for those gates.
