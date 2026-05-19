/**
 * Spec: pipeline-trust-restoration / R6 / G-P1-7
 * Covers: R6 AC 6.1, 6.2, 6.3, 6.4, 6.5 + Property P5 (Resume Idempotence)
 *
 * Verifies that strictAgents survives the session save → load → save loop
 * and that the `loadPersistedStrictAgents` helper produces the same value
 * the CLI continue path consumes.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createSessionStore,
  loadPersistedStrictAgents,
} from "../../src/state/session-store.js";

type SessionFixture = ReturnType<typeof makeSession>;

function makeSession(overrides: Partial<{ strictAgents: boolean }> = {}) {
  return {
    sessionId: "test-session",
    currentPhase: "phase-1" as const,
    batchIndex: 0,
    mode: "--complexa",
    variant: "feature-heavy",
    confidenceScore: 1,
    ...overrides,
  };
}

async function saveAndLoad(
  fixture: SessionFixture,
  defaults: { strictAgents?: boolean } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "pipeline-resume-strict-"));
  const store = createSessionStore(root, defaults);
  await store.save(fixture);
  return {
    root,
    loaded: await store.load(),
  };
}

describe("R6: session preserves strictAgents", () => {
  it("R6 AC 6.1: strictAgents is persisted when supplied to the store defaults", async () => {
    const { loaded } = await saveAndLoad(makeSession(), { strictAgents: true });
    expect(loaded.strictAgents).toBe(true);
  });

  it("R6 AC 6.1: strictAgents on the session itself wins over store defaults", async () => {
    const { loaded } = await saveAndLoad(
      makeSession({ strictAgents: false }),
      { strictAgents: true },
    );
    expect(loaded.strictAgents).toBe(false);
  });

  it("R6 AC 6.2: loadPersistedStrictAgents returns the saved value", async () => {
    const { root } = await saveAndLoad(makeSession(), { strictAgents: true });
    expect(await loadPersistedStrictAgents(root)).toBe(true);
  });

  it("R6 AC 6.3: legacy session without strictAgents loads as undefined (no schema error)", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-resume-strict-legacy-"));
    // Write a legacy session manually (no strictAgents field).
    writeFileSync(
      join(root, "session.json"),
      JSON.stringify({
        sessionId: "legacy",
        currentPhase: "phase-1",
        batchIndex: 0,
        mode: "--media",
        variant: "feature-light",
        confidenceScore: 1,
      }),
      "utf8",
    );
    expect(await loadPersistedStrictAgents(root)).toBeUndefined();
  });

  it("R6: peek helper returns undefined when no session file exists", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-resume-strict-empty-"));
    expect(await loadPersistedStrictAgents(root)).toBeUndefined();
  });
});

describe("P5: Resume Idempotence on strictAgents (R6)", () => {
  it("R6 AC 6.4: N consecutive resumes preserve strictAgents (idempotent)", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-resume-strict-idem-"));
    const store = createSessionStore(root, { strictAgents: true });
    let session: Record<string, unknown> = makeSession();

    for (let resume = 0; resume < 5; resume += 1) {
      await store.save(session);
      session = await store.load() as Record<string, unknown>;
    }

    expect(session.strictAgents).toBe(true);
  });

  it("idempotence holds for strictAgents=false too", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-resume-strict-idem-false-"));
    const store = createSessionStore(root, { strictAgents: false });
    let session: Record<string, unknown> = makeSession();

    for (let resume = 0; resume < 5; resume += 1) {
      await store.save(session);
      session = await store.load() as Record<string, unknown>;
    }

    expect(session.strictAgents).toBe(false);
  });
});
