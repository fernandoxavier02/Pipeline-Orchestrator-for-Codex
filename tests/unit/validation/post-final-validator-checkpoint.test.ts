import { describe, expect, it } from "vitest";
import { recordPostFinalValidatorCheckpoint } from "../../../src/validation/final-validator.js";

type SavedState = {
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
