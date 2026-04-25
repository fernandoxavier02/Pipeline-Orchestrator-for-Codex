import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGateLog } from "../../../src/state/gate-log.js";

describe("gate-log.list — crash-safe JSONL parsing (B10)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gate-log-"));
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("tolerates a truncated final line (process crashed mid-append)", async () => {
    const valid = {
      gate: "INFO_GATE_OK",
      hardness: "SOFT",
      phase: "phase-0",
      decision: "pass",
      decided_by: "controller",
      timestamp: "2026-04-25T00:00:00.000Z",
      detail: "ok",
      confidence_impact: 0,
    };
    const file = join(dir, "gate-decisions.jsonl");
    writeFileSync(file, `${JSON.stringify(valid)}\n`, "utf8");
    appendFileSync(file, `{"gate":"INFO_GATE_OK","hardness":"SOFT","ph`); // truncated
    const log = createGateLog(dir);
    const entries = await log.list();
    expect(entries).toHaveLength(1);
    expect(entries[0].gate).toBe("INFO_GATE_OK");
  });

  it("throws on a partial line in the middle (data corruption, not a crash)", async () => {
    const valid = {
      gate: "INFO_GATE_OK",
      hardness: "SOFT",
      phase: "phase-0",
      decision: "pass",
      decided_by: "controller",
      timestamp: "2026-04-25T00:00:00.000Z",
      detail: "ok",
      confidence_impact: 0,
    };
    const file = join(dir, "gate-decisions.jsonl");
    writeFileSync(
      file,
      `${JSON.stringify(valid)}\n{"corrupt":\n${JSON.stringify(valid)}\n`,
      "utf8",
    );
    const log = createGateLog(dir);
    await expect(log.list()).rejects.toBeTruthy();
  });
});
