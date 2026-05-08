import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGateLog } from "../../../src/state/gate-log.js";

describe("gate log", () => {
  it("appends jsonl gate decisions", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-gates-"));
    const log = createGateLog(root);

    await expect(log.append({
      gate: "INFO_GATE_BLOCKED",
      hardness: "MANDATORY",
      phase: "phase-0",
      decision: "block",
      decided_by: "controller",
      timestamp: "2026-04-01T12:00:00.000Z",
      detail: "Missing reproduction steps",
      confidence_impact: 0,
    })).resolves.toBeUndefined();

    const raw = readFileSync(join(root, "gate-decisions.jsonl"), "utf8");
    expect(raw).toContain("\"gate\":\"INFO_GATE_BLOCKED\"");
    const entry = JSON.parse(raw.trim());
    expect(entry.execution_identity).toMatchObject({
      plugin_name: "pipeline-orchestrator-for-codex",
      surface: "gate-log",
      source: "runtime",
    });
    expect(entry.execution_identity.trace_id).toMatch(/^pipe-/);
  });

  it("rejects malformed current gate log rows", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-gates-current-"));
    const log = createGateLog(root);

    writeFileSync(
      join(root, "gate-decisions.jsonl"),
      `${JSON.stringify({
        gate: "INFO_GATE_BLOCKED",
        status: "blocked",
        reason: "Missing reproduction steps",
      })}\n`,
      "utf8",
    );

    await expect(log.list()).rejects.toThrow();
  });
});
