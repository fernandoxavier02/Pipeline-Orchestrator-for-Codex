# Runtime-First Rewrite Remaining Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for same-session execution or superpowers:executing-plans for fresh-session execution from this document. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the remaining runtime-first rewrite work so Phase 3 is fully explicit, the controller becomes orchestration-only, docs match shipped behavior, and the repository can pass final acceptance with fresh evidence.

**Architecture:** Keep the controller sovereign only for phase transitions, gate decisions, rollback routing, and persistence. Move remaining operational interpretation into explicit runtime or narrowly scoped helper adapters, then make docs and acceptance reflect only the runtime that actually ships.

**Tech Stack:** TypeScript, Vitest, Zod, prompt-registry contracts, runtime dispatcher, persistent JSONL/JSON stores

---

## File Structure And Responsibilities

### Already-existing files that remain authoritative

- `src/index.ts`
  - Runtime assembly, prompt preload, runtime dispatcher wrapping, closeout entrypoint
- `src/controller/pipeline-controller.ts`
  - Controller orchestration, phase transitions, gate persistence, rollback routing
- `src/closeout/render-closeout.ts`
  - Presentation-only rendering of the final closeout result
- `src/validation/final-validator.ts`
  - Pure decision helpers for final validation and sanity checking
- `src/continue/resume-pipeline.ts`
  - Minimal resume routing helper
- `tests/integration/closeout/closeout-confirm.test.ts`
  - Phase 3 integration surface
- `tests/integration/validation/final-validator-gate-log.test.ts`
  - Final validation correctness surface
- `tests/integration/execution/controller-routing.test.ts`
  - End-to-end controller/execution routing surface
- `tests/unit/controller/pipeline-controller.test.ts`
  - Controller-focused behavior surface
- `tests/unit/continue/resume-pipeline.test.ts`
  - Resume-specific unit surface

### New focused helpers to add

- `src/closeout/persisted-closeout.ts`
  - Builds one authoritative `closeout` object from validation output plus authoritative evidence
  - Keeps `src/index.ts` from assembling the persisted result inline
- `src/controller/continuation-outcome.ts`
  - Normalizes execution payload into controller-level orchestration decisions (`blocker`, `nextPhase`, `pendingDecision`)
  - Removes payload interpretation from `pipeline-controller.ts`
- `src/controller/continue-state.ts`
  - Isolates continue-mode blocking logic for rollback, stale context, and proposal-confirmation gates
  - Keeps `pipeline-controller.ts` focused on orchestration rather than branching logic

### Docs to converge last

- `README.md`
- `docs/pipeline-orchestrator-codex/09-gap-analysis.md`
- `docs/pipeline-orchestrator-codex/10-source-inventory.md`

---

### Task 1: Batch A — Extract Authoritative Closeout Result Assembly

**Files:**
- Create: `src/closeout/persisted-closeout.ts`
- Modify: `src/index.ts`
- Test: `tests/unit/closeout/persisted-closeout.test.ts`
- Test: `tests/integration/closeout/closeout-confirm.test.ts`

- [ ] **Step 1: Write the failing unit test for the authoritative closeout builder**

```ts
import { describe, expect, it } from "vitest";
import { buildPersistedCloseout } from "../../../src/closeout/persisted-closeout.js";

describe("persisted closeout builder", () => {
  it("builds the authoritative closeout result from validation plus evidence", () => {
    const result = buildPersistedCloseout({
      validation: {
        decision: "GO",
        confidenceScore: 0.91,
        confidenceBand: "high",
        requiredEvidence: ["build", "tests", "final-review"],
        missingEvidence: [],
        verificationEvidence: [
          { kind: "build", passed: true, label: "npm run build" },
          { kind: "tests", passed: true, label: "npm test" },
        ],
        blockingGates: [],
        skippedSoftGates: [],
        blockedReviews: 0,
        rollbackHint: undefined,
      },
      verificationEvidence: [
        { kind: "build", passed: true, label: "npm run build" },
        { kind: "tests", passed: true, label: "npm test" },
        { kind: "final-review", passed: true, label: "final adversarial review" },
      ],
      updatedAt: "2026-04-12T12:00:00.000Z",
    });

    expect(result).toEqual({
      decision: "GO",
      confidenceScore: 0.91,
      confidenceBand: "high",
      missingEvidence: [],
      blockingGates: [],
      skippedSoftGates: [],
      blockedReviews: 0,
      rollbackHint: undefined,
      verificationEvidence: [
        { kind: "build", passed: true, label: "npm run build" },
        { kind: "tests", passed: true, label: "npm test" },
        { kind: "final-review", passed: true, label: "final adversarial review" },
      ],
      updatedAt: "2026-04-12T12:00:00.000Z",
    });
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- tests/unit/closeout/persisted-closeout.test.ts`
Expected: FAIL with module-not-found or missing export for `buildPersistedCloseout`

- [ ] **Step 3: Write the minimal closeout builder**

```ts
export function buildPersistedCloseout(input: {
  validation: {
    decision: "GO" | "CONDITIONAL" | "NO-GO";
    confidenceScore: number;
    confidenceBand: "low" | "medium" | "high";
    missingEvidence: string[];
    blockingGates: string[];
    skippedSoftGates: string[];
    blockedReviews: number;
    rollbackHint?: string;
  };
  verificationEvidence: Array<{ kind: string; passed: boolean; label?: string }>;
  updatedAt: string;
}) {
  return {
    decision: input.validation.decision,
    confidenceScore: input.validation.confidenceScore,
    confidenceBand: input.validation.confidenceBand,
    missingEvidence: input.validation.missingEvidence,
    blockingGates: input.validation.blockingGates,
    skippedSoftGates: input.validation.skippedSoftGates,
    blockedReviews: input.validation.blockedReviews,
    rollbackHint: input.validation.rollbackHint,
    verificationEvidence: input.verificationEvidence,
    updatedAt: input.updatedAt,
  };
}
```

- [ ] **Step 4: Replace inline closeout assembly in the runtime**

Modify `src/index.ts` so both the persisted-session path and the no-session fallback path use the same helper:

```ts
const persistedCloseout = buildPersistedCloseout({
  validation,
  verificationEvidence,
  updatedAt: new Date().toISOString(),
});

await closeoutStores.session.save({
  ...session,
  closeout: persistedCloseout,
});

const text = renderCloseout({
  closeout: persistedCloseout,
  batches: input.batches,
  validationIntent: input.validationIntent,
});
```

- [ ] **Step 5: Keep `renderCloseout` untouched and presentation-only**

Do not change `src/closeout/render-closeout.ts` in this batch unless the extraction exposes a real defect. The batch is done only if the helper extraction lands without changing the already-shipped presentation contract.

- [ ] **Step 6: Run focused verification for Batch A**

Run:
- `npm test -- tests/unit/closeout/persisted-closeout.test.ts`
- `npm test -- tests/integration/closeout/closeout-confirm.test.ts`

Expected:
- all tests PASS
- no regression in persisted closeout shape or returned closeout text

- [ ] **Step 7: Run adversarial review loop for Batch A**

Review checklist:
- Does any text field in `renderCloseout` depend on transient validation values instead of persisted `closeout`?
- Can the runtime return text that disagrees with `session.closeout`?
- Did any fallback path skip persistence and still claim authoritative output?

If the answer to any item is “yes”:
- fix the issue
- rerun:
  - `npm test -- tests/unit/closeout/persisted-closeout.test.ts`
  - `npm test -- tests/integration/closeout/closeout-confirm.test.ts`
- repeat up to 3 loops
- on the 3rd loop, change strategy by reducing inline branching instead of patching text formatting

- [ ] **Step 8: Commit Batch A**

```bash
git add src/closeout/persisted-closeout.ts src/index.ts tests/unit/closeout/persisted-closeout.test.ts tests/integration/closeout/closeout-confirm.test.ts
git commit -m "refactor: centralize persisted closeout result assembly"
```

---

### Task 2: Batch B — Slim Controller Continuation Outcome Interpretation

**Files:**
- Create: `src/controller/continuation-outcome.ts`
- Modify: `src/controller/pipeline-controller.ts`
- Test: `tests/unit/controller/continuation-outcome.test.ts`
- Test: `tests/unit/controller/pipeline-controller.test.ts`
- Test: `tests/integration/execution/controller-routing.test.ts`

- [ ] **Step 1: Write the failing unit test for continuation outcome normalization**

```ts
import { describe, expect, it } from "vitest";
import { deriveContinuationOutcome } from "../../../src/controller/continuation-outcome.js";

describe("continuation outcome", () => {
  it("maps final adversarial rework to replan and phase-2 rollback", () => {
    const result = deriveContinuationOutcome({
      executionResult: {
        status: "blocked",
        blockedBy: "FINAL_ADVERSARIAL_REWORK",
      },
    });

    expect(result).toEqual({
      blocker: "FINAL_ADVERSARIAL_REWORK",
      nextPhase: "phase-2",
      pendingDecision: "replan",
      checkpointFailure: false,
      circuitBreaker: false,
    });
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- tests/unit/controller/continuation-outcome.test.ts`
Expected: FAIL because `deriveContinuationOutcome` does not exist

- [ ] **Step 3: Write the minimal helper**

```ts
export function deriveContinuationOutcome(input: { executionResult: unknown }) {
  const payload = input.executionResult && typeof input.executionResult === "object"
    ? input.executionResult as Record<string, unknown>
    : {};
  const status = typeof payload.status === "string" ? payload.status : undefined;
  const blocker =
    status === "blocked"
      ? (typeof payload.blockedBy === "string" ? payload.blockedBy : "phase-2-blocked")
      : status === "STOP_RULE" || status === "FIX_LOOP_EXHAUSTED"
        ? status
        : status === "failed"
          ? "CHECKPOINT_FAIL"
          : undefined;

  return {
    blocker,
    nextPhase: blocker === "FINAL_ADVERSARIAL_REWORK" ? "phase-2" : status === "blocked" ? "phase-1.5" : "phase-2",
    pendingDecision:
      blocker === "FINAL_ADVERSARIAL_REWORK"
        ? "replan"
        : status === "blocked"
          ? "phase-2-proof-required"
          : status === "failed"
            ? "revalidate"
            : status === "STOP_RULE" || status === "FIX_LOOP_EXHAUSTED"
              ? "stop"
              : undefined,
    checkpointFailure: status === "failed",
    circuitBreaker: status === "STOP_RULE" || status === "FIX_LOOP_EXHAUSTED",
  };
}
```

- [ ] **Step 4: Replace inline continuation interpretation in the controller**

Modify `src/controller/pipeline-controller.ts` so `executeApprovedContinuation(...)` uses the helper instead of computing:
- `blocker`
- `nextPhase`
- `pendingDecision`
- `isCheckpointFailure`
- `isCircuitBreaker`

Use:

```ts
const continuation = deriveContinuationOutcome({
  executionResult,
});
```

- [ ] **Step 5: Write/adjust the controller integration test**

Extend `tests/unit/controller/pipeline-controller.test.ts` or `tests/integration/execution/controller-routing.test.ts` with one assertion that the controller still persists:

```ts
expect(result.rollbackGate).toBe("FINAL_ADVERSARIAL_REWORK");
expect(result.rollbackRoute).toBe("replan");
```

- [ ] **Step 6: Run focused verification for Batch B**

Run:
- `npm test -- tests/unit/controller/continuation-outcome.test.ts`
- `npm test -- tests/unit/controller/pipeline-controller.test.ts`
- `npm test -- tests/integration/execution/controller-routing.test.ts`

Expected:
- all tests PASS
- no behavior drift in rollback or continue semantics

- [ ] **Step 7: Run adversarial review loop for Batch B**

Review checklist:
- Did the controller stop interpreting runtime payloads inline?
- Is any operational policy duplicated in both helper and controller?
- Can `FINAL_ADVERSARIAL_REWORK`, `CHECKPOINT_FAIL`, or `STOP_RULE` resolve differently in two places?

If any answer is “yes”:
- fix the helper boundary
- rerun the same 3 commands above
- repeat up to 3 loops
- on the 3rd loop, remove duplicate controller branches instead of refining them

- [ ] **Step 8: Commit Batch B**

```bash
git add src/controller/continuation-outcome.ts src/controller/pipeline-controller.ts tests/unit/controller/continuation-outcome.test.ts tests/unit/controller/pipeline-controller.test.ts tests/integration/execution/controller-routing.test.ts
git commit -m "refactor: extract continuation outcome from controller"
```

---

### Task 3: Batch C — Slim Continue-Mode Blocking And Resume Routing

**Files:**
- Create: `src/controller/continue-state.ts`
- Modify: `src/controller/pipeline-controller.ts`
- Modify: `src/continue/resume-pipeline.ts`
- Test: `tests/unit/controller/continue-state.test.ts`
- Test: `tests/unit/continue/resume-pipeline.test.ts`
- Test: `tests/unit/controller/pipeline-controller.test.ts`

- [ ] **Step 1: Write the failing unit test for continue-state resolution**

```ts
import { describe, expect, it } from "vitest";
import { resolveContinueState } from "../../../src/controller/continue-state.js";

describe("continue state", () => {
  it("blocks continue when proposal confirmation is still pending", () => {
    const result = resolveContinueState({
      session: {
        currentPhase: "phase-1",
        pendingDecision: undefined,
      },
      gateLogEntries: [],
    });

    expect(result).toEqual({
      status: "error",
      message: "Cannot continue while proposal confirmation is pending",
    });
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- tests/unit/controller/continue-state.test.ts`
Expected: FAIL because `resolveContinueState` does not exist

- [ ] **Step 3: Write the minimal helper**

```ts
export function resolveContinueState(input: {
  session: { currentPhase: string; pendingDecision?: string };
  gateLogEntries: Array<{ gate: string; decision: string }>;
}) {
  if (input.session.currentPhase === "phase-1") {
    return {
      status: "error" as const,
      message: "Cannot continue while proposal confirmation is pending",
    };
  }

  return {
    status: "ok" as const,
  };
}
```

- [ ] **Step 4: Move continue-mode branching behind the helper**

In `src/controller/pipeline-controller.ts`, replace direct checks for:
- pending proposal confirmation
- rollback-route resume blocking
- stale-context continue blocking

with a helper call that returns a small orchestration object the controller can route on.

- [ ] **Step 5: Keep `resume-pipeline.ts` minimal**

Do not add policy to `resume-pipeline.ts`. Keep it as a small adapter:

```ts
export async function resumePipeline(input: {
  session: { currentPhase: string; [key: string]: unknown };
  checkpoints: Array<{ name: string; status: string }>;
}) {
  // only compute checkpoint-based resume points here
}
```

- [ ] **Step 6: Run focused verification for Batch C**

Run:
- `npm test -- tests/unit/controller/continue-state.test.ts`
- `npm test -- tests/unit/continue/resume-pipeline.test.ts`
- `npm test -- tests/unit/controller/pipeline-controller.test.ts`

Expected:
- PASS
- continue-mode behavior remains unchanged for approved flows and blocked flows

- [ ] **Step 7: Run adversarial review loop for Batch C**

Review checklist:
- Can a phase-1 pending proposal still slip into execution?
- Can rollback/stale-context branches diverge between helper and controller?
- Did `resume-pipeline.ts` accidentally gain policy that belongs in the controller?

If a finding appears:
- fix it
- rerun the 3 commands above
- repeat up to 3 loops
- on the 3rd loop, reduce helper scope rather than layering more conditionals

- [ ] **Step 8: Commit Batch C**

```bash
git add src/controller/continue-state.ts src/controller/pipeline-controller.ts src/continue/resume-pipeline.ts tests/unit/controller/continue-state.test.ts tests/unit/continue/resume-pipeline.test.ts tests/unit/controller/pipeline-controller.test.ts
git commit -m "refactor: isolate continue-mode state routing"
```

---

### Task 4: Batch D — Converge Runtime Docs With Shipped Behavior

**Files:**
- Modify: `README.md`
- Modify: `docs/pipeline-orchestrator-codex/09-gap-analysis.md`
- Modify: `docs/pipeline-orchestrator-codex/10-source-inventory.md`

- [ ] **Step 1: Update the README implementation status**

Replace stale bullets like:

```md
- runtime closeout helper with operator confirmation, controller-owned execution proof, gate-log evidence, and rollback hints
```

with concrete shipped behavior:

```md
- runtime Phase 3 chain with `sanity-checker`, `final-validator`, controller-authoritative closeout persistence, and presentation-only closeout rendering
```

- [ ] **Step 2: Update gap analysis to reflect current reality**

Remove or downgrade claims that are no longer true:
- “some role semantics still remain controller-owned instead of fully runtime-dispatched” for the now-shipped Phase 2/3 seams

Keep only real remaining gaps:
- controller continuation semantics
- continue-mode hybrid branches
- docs drift until this batch lands

- [ ] **Step 3: Update source inventory to list the shipped prompt/runtime artifacts**

Add the prompt/runtime files that now matter operationally:

```md
- `prompts/agents/quality/pre-tester.md`
- `prompts/agents/quality/quality-gate-router.md`
- `prompts/agents/core/sanity-checker.md`
- `prompts/agents/core/final-validator.md`
```

Also note that these are not only source references but shipped runtime contracts.

- [ ] **Step 4: Run doc review checklist**

Checklist:
- Does any doc still describe Phase 3 as mainly helper-driven?
- Does any doc understate runtime prompt contracts that now ship?
- Does any doc claim controller ownership of behavior that has already moved to runtime?

- [ ] **Step 5: Commit Batch D**

```bash
git add README.md docs/pipeline-orchestrator-codex/09-gap-analysis.md docs/pipeline-orchestrator-codex/10-source-inventory.md
git commit -m "docs: align runtime rewrite docs with shipped behavior"
```

---

### Task 5: Batch E — Full Acceptance Pass

**Files:**
- Modify only if acceptance reveals a real defect
- Review: `README.md`
- Review: `docs/pipeline-orchestrator-codex/09-gap-analysis.md`
- Review: `docs/pipeline-orchestrator-codex/10-source-inventory.md`
- Review: `tests/integration/**`
- Review: `tests/unit/**`

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests PASS

- [ ] **Step 2: Run the type-only acceptance check**

Run: `npm run lint:types`
Expected: PASS with no TypeScript errors

- [ ] **Step 3: Perform final acceptance review against the spec**

Checklist:
- Phase 0, Phase 1.5, Phase 2, and Phase 3 are explicit role chains
- controller only orchestrates, persists, gates, and routes
- team-composed runtime behavior is real where promised
- docs and shipped runtime say the same thing

- [ ] **Step 4: If acceptance reveals a defect, open one micro-batch**

Rules:
- write the failing test first
- run it and capture the failure
- implement the smallest fix
- rerun the focused test
- rerun `npm test`
- rerun `npm run lint:types`

- [ ] **Step 5: Run final adversarial review loop**

Review checklist:
- Any hidden controller-owned substitute path left for a shipped runtime role?
- Any fail-open behavior in continue, rollback, or closeout?
- Any doc claim that exceeds real runtime behavior?

If yes:
- fix only the accepted defect
- rerun:
  - `npm test`
  - `npm run lint:types`
- repeat up to 3 loops
- on the 3rd loop, stop and surface the remaining blocker explicitly

- [ ] **Step 6: Commit acceptance clean-up**

```bash
git add .
git commit -m "chore: finalize runtime-first rewrite acceptance pass"
```
