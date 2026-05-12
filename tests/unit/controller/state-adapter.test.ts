import { describe, expect, it } from "vitest";
import { createStateAdapter } from "../../../src/controller/state-adapter.js";
import type { SentinelState } from "../../../src/sentinel/sentinel-state.js";

function createMemoryStores() {
  let session: unknown | undefined;
  const checkpoints: Array<{ name: string; status: string }> = [];
  const gateDecisions: unknown[] = [];
  let confidence: unknown | undefined;
  let sentinel: SentinelState | undefined;

  return {
    session: {
      async load() {
        return session;
      },
      async save(next: unknown) {
        session = next;
      },
    },
    checkpoints: {
      async list() {
        return checkpoints;
      },
      async save(next: unknown) {
        checkpoints.push(next as { name: string; status: string });
      },
    },
    gateLog: {
      async append(decision: unknown) {
        gateDecisions.push(decision);
      },
      async list() {
        return gateDecisions as any;
      },
    },
    confidence: {
      async load() {
        return confidence;
      },
      async save(next: unknown) {
        confidence = next;
      },
    },
    sentinel: {
      async load() {
        return sentinel as SentinelState;
      },
      async save(next: unknown) {
        sentinel = next as SentinelState;
      },
    },
  } as any;
}

describe("state adapter (ATDD)", () => {
  it("loadSession returns undefined when no session exists", async () => {
    const stores = createMemoryStores();
    const adapter = createStateAdapter(stores);
    const result = await adapter.loadSession();
    expect(result).toBeUndefined();
  });

  it("saveSession + loadSession roundtrip preserves data", async () => {
    const stores = createMemoryStores();
    const adapter = createStateAdapter(stores);
    const state = { sessionId: "sess-123", currentPhase: "phase-1" };

    await adapter.saveSession(state);
    const loaded = await adapter.loadSession();

    expect(loaded).toEqual(state);
  });

  it("listCheckpoints returns empty array when no checkpoints exist", async () => {
    const stores = createMemoryStores();
    const adapter = createStateAdapter(stores);
    const result = await adapter.listCheckpoints();
    expect(result).toEqual([]);
  });

  it("saveCheckpoint + listCheckpoints roundtrip preserves data", async () => {
    const stores = createMemoryStores();
    const adapter = createStateAdapter(stores);
    const cp = { name: "batch-1", status: "passed" };

    await adapter.saveCheckpoint(cp);
    const list = await adapter.listCheckpoints();

    expect(list).toHaveLength(1);
    expect(list[0]).toEqual(cp);
  });

  it("appendGateDecision + listGateDecisions roundtrip preserves data", async () => {
    const stores = createMemoryStores();
    const adapter = createStateAdapter(stores);
    const decision = {
      gate: "INFO_GATE_BLOCKED",
      hardness: "HARD",
      phase: "phase-0",
      decision: "block",
      decided_by: "controller",
      timestamp: "2026-05-11T12:00:00Z",
      detail: "missing SSOT",
      confidence_impact: -0.15,
    };

    await adapter.appendGateDecision(decision);
    const list = await adapter.listGateDecisions();

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject(decision);
  });

  it("loadConfidence returns undefined when no confidence exists", async () => {
    const stores = createMemoryStores();
    const adapter = createStateAdapter(stores);
    const result = await adapter.loadConfidence();
    expect(result).toBeUndefined();
  });

  it("saveConfidence + loadConfidence roundtrip preserves data", async () => {
    const stores = createMemoryStores();
    const adapter = createStateAdapter(stores);
    const score = { score: 0.85, band: "green" };

    await adapter.saveConfidence(score);
    const loaded = await adapter.loadConfidence();

    expect(loaded).toEqual(score);
  });

  it("loadSentinel returns undefined when no sentinel exists", async () => {
    const stores = createMemoryStores();
    const adapter = createStateAdapter(stores);
    const result = await adapter.loadSentinel();
    expect(result).toBeUndefined();
  });

  it("saveSentinel + loadSentinel roundtrip preserves data", async () => {
    const stores = createMemoryStores();
    const adapter = createStateAdapter(stores);
    const state = { expected_next: "task-orchestrator", checkpoints: [] };

    await adapter.saveSentinel(state);
    const loaded = await adapter.loadSentinel();

    expect(loaded).toEqual(state);
  });
});
