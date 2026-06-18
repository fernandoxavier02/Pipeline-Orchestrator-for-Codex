import { describe, expect, it } from "vitest";
import { REQUIRED_PIPELINE_GATES } from "../../../src/governance/pipeline-contract.js";
import { recordPostFinalValidatorCheckpoint } from "../../../src/validation/final-validator.js";
import { runFinalValidator } from "../../../src/validation/final-validator.js";

type SavedState = {
  session_id?: string;
  run_id?: string;
  workflow_id?: string;
  created_by_runtime?: boolean;
  runtime_mode?: "real-agent" | "harness" | "blocked-no-agent-runtime" | "dev-bypass";
  pipelineActive: boolean;
  currentPhase: "phase-0" | "phase-1" | "phase-1.5" | "phase-2" | "phase-3";
  currentAgent: string;
  expectedNext: string[];
  completedPhases: Array<"phase-0" | "phase-1" | "phase-1.5" | "phase-2" | "phase-3">;
  gateSummary: string[];
  batchState: { batchIndex: number; status: string };
  consecutiveCorrections: number;
  lastCheckpoint:
    | "post_orchestrator"
    | "phase_0_to_1"
    | "phase_1_to_2"
    | "phase_2_to_3"
    | "post_final_validator";
  updatedAt: string;
};

function makeStore(initial?: Partial<SavedState>) {
  let saved: SavedState | undefined = initial as SavedState | undefined;
  return {
    saves: [] as SavedState[],
    save(state: SavedState) {
      saved = state;
      this.saves.push(state);
    },
    load() {
      return saved as SavedState;
    },
  };
}

describe("recordPostFinalValidatorCheckpoint", () => {
  it("writes lastCheckpoint=post_final_validator with phase-3 + completed phases", async () => {
    const store = makeStore();
    await recordPostFinalValidatorCheckpoint({
      sentinelStore: store,
      decision: "GO",
      batchIndex: 2,
    });
    expect(store.saves).toHaveLength(1);
    const saved = store.saves[0];
    expect(saved.lastCheckpoint).toBe("post_final_validator");
    expect(saved.currentPhase).toBe("phase-3");
    expect(saved.currentAgent).toBe("final-validator");
    expect(saved.completedPhases).toContain("phase-2");
    expect(saved.completedPhases).toContain("phase-3");
    expect(saved.batchState.batchIndex).toBe(2);
    expect(saved.batchState.status).toContain("go");
  });

  it("preserves prior completedPhases and consecutiveCorrections", async () => {
    const prior: SavedState = {
      pipelineActive: true,
      currentPhase: "phase-2",
      currentAgent: "pipeline-controller",
      expectedNext: [],
      completedPhases: ["phase-0", "phase-1"],
      gateSummary: ["SENTINEL_CHECKPOINT"],
      batchState: { batchIndex: 1, status: "phase-2-complete" },
      consecutiveCorrections: 2,
      lastCheckpoint: "phase_2_to_3",
      updatedAt: "2026-04-25T00:00:00.000Z",
    };
    const store = makeStore(prior);
    await recordPostFinalValidatorCheckpoint({
      sentinelStore: store,
      decision: "CONDITIONAL",
    });
    const saved = store.saves[0];
    expect(saved.consecutiveCorrections).toBe(2);
    expect(saved.completedPhases).toEqual(
      expect.arrayContaining(["phase-0", "phase-1", "phase-2", "phase-3"]),
    );
  });

  it("TDD: preserves prior execution identity on the post-final sentinel checkpoint", async () => {
    const prior: SavedState = {
      session_id: "session-current",
      run_id: "run-current",
      workflow_id: "full",
      created_by_runtime: true,
      runtime_mode: "real-agent",
      pipelineActive: true,
      currentPhase: "phase-3",
      currentAgent: "pipeline-controller",
      expectedNext: ["final_verdict"],
      completedPhases: ["phase-0", "phase-1", "phase-2"],
      gateSummary: ["SENTINEL_CHECKPOINT"],
      batchState: { batchIndex: 3, status: "phase-3" },
      consecutiveCorrections: 1,
      lastCheckpoint: "phase_2_to_3",
      updatedAt: "2026-04-25T00:00:00.000Z",
    };
    const store = makeStore(prior);

    await recordPostFinalValidatorCheckpoint({
      sentinelStore: store,
      decision: "GO",
    });

    const saved = store.saves[0];
    expect(saved.session_id).toBe("session-current");
    expect(saved.run_id).toBe("run-current");
    expect(saved.workflow_id).toBe("full");
    expect(saved.created_by_runtime).toBe(true);
    expect(saved.runtime_mode).toBe("real-agent");
  });

  it("marks pipelineActive=false when decision is GO and =true on NO-GO", async () => {
    const ok = makeStore();
    await recordPostFinalValidatorCheckpoint({ sentinelStore: ok, decision: "GO" });
    expect(ok.saves[0].pipelineActive).toBe(false);

    const noGo = makeStore();
    await recordPostFinalValidatorCheckpoint({ sentinelStore: noGo, decision: "NO-GO" });
    expect(noGo.saves[0].pipelineActive).toBe(true);
  });

  it("is a no-op when no sentinel store is provided", async () => {
    await expect(
      recordPostFinalValidatorCheckpoint({ decision: "GO" }),
    ).resolves.toBeUndefined();
  });

  it("tolerates a load() that throws (returns no prior state)", async () => {
    const broken = {
      saves: [] as SavedState[],
      save(state: SavedState) { this.saves.push(state); },
      load() { throw new Error("boom"); },
    };
    await recordPostFinalValidatorCheckpoint({
      sentinelStore: broken,
      decision: "GO",
    });
    expect(broken.saves).toHaveLength(1);
    expect(broken.saves[0].completedPhases).toContain("phase-3");
  });
});

describe("operational final validation", () => {
  const requiredGovernanceGateLog = REQUIRED_PIPELINE_GATES.map((gate) => ({
    gate,
    hardness: "HARD" as const,
    phase: "phase-3",
    decision: "pass" as const,
    decided_by: "controller" as const,
    timestamp: "2026-04-02T12:00:00.000Z",
    detail: `${gate} passed`,
    confidence_impact: 0,
  }));
  const canonicalEvidence = [
    { kind: "protocol-events", passed: true, label: "target protocol-events.jsonl" },
    { kind: "gate-decisions", passed: true, label: "target gate-decisions.jsonl" },
    { kind: "target-latest-trace", passed: true, label: "target latest_trace.json" },
  ];

  it("rejects harness/emulation evidence for operational runs", () => {
    const result = runFinalValidator({
      reviews: [{ status: "approved" }],
      confidenceScore: 0.95,
      gateLog: [],
      verificationEvidence: [
        { kind: "build", passed: true, label: "npm run build" },
        { kind: "tests", passed: true, label: "npm test" },
        { kind: "final-review", passed: true, label: "parallel-emulation final review" },
        ...canonicalEvidence,
      ],
      validationIntent: "standard",
      mode: "full",
      dispatchMode: "parallel-emulation",
    });

    expect(result.decision).toBe("NO-GO");
    expect(result.missingEvidence).toContain("real-agent-dispatch");
  });

  it("rejects real-agent operational runs without canonical target artifacts", () => {
    const result = runFinalValidator({
      reviews: [{ status: "approved" }],
      confidenceScore: 0.95,
      gateLog: requiredGovernanceGateLog,
      verificationEvidence: [
        { kind: "build", passed: true, label: "npm run build" },
        { kind: "tests", passed: true, label: "npm test" },
        { kind: "final-review", passed: true, label: "final adversarial review" },
      ],
      validationIntent: "standard",
      mode: "full",
      dispatchMode: "real-agent",
    });

    expect(result.decision).toBe("NO-GO");
    expect(result.missingEvidence).toEqual(expect.arrayContaining([
      "protocol-events",
      "gate-decisions",
      "target-latest-trace",
    ]));
  });

  it("rejects real-agent operational runs without mandatory governance gates", () => {
    const result = runFinalValidator({
      reviews: [{ status: "approved" }],
      confidenceScore: 0.95,
      gateLog: [],
      verificationEvidence: [
        { kind: "build", passed: true, label: "npm run build" },
        { kind: "tests", passed: true, label: "npm test" },
        { kind: "final-review", passed: true, label: "final adversarial review" },
        ...canonicalEvidence,
      ],
      validationIntent: "standard",
      mode: "full",
      dispatchMode: "real-agent",
    });

    expect(result.decision).toBe("NO-GO");
    expect(result.blockingGates).toEqual(expect.arrayContaining(["CAPABILITY_GATE", "FINAL_VERDICT_GATE"]));
    expect(result.missingEvidence).toEqual(expect.arrayContaining(["gate:CAPABILITY_GATE", "gate:FINAL_VERDICT_GATE"]));
  });

  it.each(["--complexa", "--plan", "--grill", "--media", "--simples", "--hotfix"])(
    "requires canonical artifacts for forced mode %s (same as full)",
    (forcedMode) => {
      const result = runFinalValidator({
        reviews: [{ status: "approved" }],
        confidenceScore: 0.95,
        gateLog: [],
        verificationEvidence: [
          { kind: "build", passed: true, label: "npm run build" },
          { kind: "tests", passed: true, label: "npm test" },
          { kind: "final-review", passed: true, label: "final adversarial review" },
        ],
        validationIntent: forcedMode === "--hotfix" ? "reduced" : "standard",
        mode: forcedMode,
        dispatchMode: "real-agent",
      });

      if (forcedMode === "--hotfix") {
        expect(result.missingEvidence).not.toEqual(
          expect.arrayContaining(["protocol-events"]),
        );
      } else {
        expect(result.decision).toBe("NO-GO");
        expect(result.missingEvidence).toEqual(expect.arrayContaining([
          "protocol-events",
          "gate-decisions",
          "target-latest-trace",
        ]));
      }
    },
  );

  it.each(["DIAGNOSTIC", "Diagnostic", " diagnostic ", "Review-Only", "REVIEW-ONLY"])(
    "F5: case-insensitive + trimmed mode %s is recognized as exempt",
    (variant) => {
      const result = runFinalValidator({
        reviews: [{ status: "approved" }],
        confidenceScore: 0.95,
        gateLog: [],
        verificationEvidence: [
          { kind: "build", passed: true, label: "npm run build" },
          { kind: "tests", passed: true, label: "npm test" },
        ],
        validationIntent: "standard",
        mode: variant,
      });

      expect(result.missingEvidence).not.toEqual(
        expect.arrayContaining(["protocol-events", "gate-decisions", "target-latest-trace"]),
      );
    },
  );

  it.each(["diagnostic", "review-only"])(
    "does NOT require canonical artifacts for exempt mode %s",
    (exemptMode) => {
      const result = runFinalValidator({
        reviews: [{ status: "approved" }],
        confidenceScore: 0.95,
        gateLog: [],
        verificationEvidence: [
          { kind: "build", passed: true, label: "npm run build" },
          { kind: "tests", passed: true, label: "npm test" },
        ],
        validationIntent: "standard",
        mode: exemptMode,
      });

      expect(result.missingEvidence).not.toEqual(
        expect.arrayContaining(["protocol-events", "gate-decisions", "target-latest-trace"]),
      );
    },
  );

  it("F8: requires protocol-events when runtime is expected to produce it", () => {
    const result = runFinalValidator({
      reviews: [{ status: "approved" }],
      confidenceScore: 0.95,
      gateLog: [],
      verificationEvidence: [
        { kind: "build", passed: true, label: "npm run build" },
        { kind: "tests", passed: true, label: "npm test" },
        { kind: "final-review", passed: true, label: "final adversarial review" },
        { kind: "gate-decisions", passed: true, label: "target gate-decisions.jsonl" },
        { kind: "target-latest-trace", passed: true, label: "target latest_trace.json" },
      ],
      validationIntent: "standard",
      mode: "full",
      dispatchMode: "real-agent",
    });

    expect(result.decision).toBe("NO-GO");
    expect(result.missingEvidence).toContain("protocol-events");
  });

  it("allows real-agent operational runs with canonical target artifacts", () => {
    const result = runFinalValidator({
      reviews: [{ status: "approved" }],
      confidenceScore: 0.95,
      gateLog: requiredGovernanceGateLog,
      verificationEvidence: [
        { kind: "build", passed: true, label: "npm run build" },
        { kind: "tests", passed: true, label: "npm test" },
        { kind: "final-review", passed: true, label: "final adversarial review" },
        ...canonicalEvidence,
      ],
      validationIntent: "standard",
      mode: "full",
      dispatchMode: "real-agent",
    });

    expect(result.decision).toBe("GO");
    expect(result.missingEvidence).toEqual([]);
  });
});
