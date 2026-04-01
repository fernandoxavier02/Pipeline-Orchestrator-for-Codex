import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGateLog } from "../../../src/state/gate-log.js";

describe("gate log", () => {
  it("appends jsonl gate decisions", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-gates-"));
    const log = createGateLog(root);

    await log.append({
      gate: "INFO_GATE_BLOCKED",
      status: "blocked",
      hardness: "MANDATORY",
      reason: "Missing reproduction steps",
    });

    const raw = readFileSync(join(root, "gate-decisions.jsonl"), "utf8");
    expect(raw).toContain("\"gate\":\"INFO_GATE_BLOCKED\"");
  });
});
