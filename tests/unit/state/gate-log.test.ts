import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createGateLog,
  inferDecidedBy,
  MAX_DETAIL_LENGTH,
  recordGateDecision,
  sanitizeDetail,
} from "../../../src/state/gate-log.js";

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

// Spec: pipeline-trust-restoration / R1 — Distinguishable Emulated Dispatches
// Covers: R1 AC 1.1, 1.2, 1.3 + Property P1 (Provenance Determinism)
describe("inferDecidedBy (R1 provenance mapping)", () => {
  it("R1 AC 1.1: dispatch + emulated → decided_by='system'", () => {
    expect(inferDecidedBy({ source: "dispatch", dispatchMode: "emulated" }))
      .toBe("system");
  });

  it("R1 AC 1.2: dispatch + real → decided_by='controller'", () => {
    expect(inferDecidedBy({ source: "dispatch", dispatchMode: "real" }))
      .toBe("controller");
  });

  it("infers decided_by='user' for source='user'", () => {
    expect(inferDecidedBy({ source: "user" })).toBe("user");
  });

  it("infers decided_by='controller' for source='controller'", () => {
    expect(inferDecidedBy({ source: "controller" })).toBe("controller");
  });

  it("infers decided_by='resume-router' for source='resume-router'", () => {
    expect(inferDecidedBy({ source: "resume-router" })).toBe("resume-router");
  });

  it("R1 AC 1.3: throws on indeterminable provenance", () => {
    // Forcing the never branch via cast — simulates a bad input from a
    // non-TypeScript caller or a future enum addition that the writer
    // does not understand. The writer must refuse rather than guess.
    expect(() =>
      inferDecidedBy({ source: "alien" } as unknown as Parameters<typeof inferDecidedBy>[0]),
    ).toThrow(/indeterminable provenance/);
  });
});

describe("sanitizeDetail", () => {
  it("trims detail to MAX_DETAIL_LENGTH", () => {
    const long = "x".repeat(500);
    expect(sanitizeDetail(long)).toHaveLength(MAX_DETAIL_LENGTH);
  });

  it("strips newlines and carriage returns", () => {
    expect(sanitizeDetail("line1\nline2\r\nline3")).toBe("line1 line2 line3");
  });

  it("preserves short details verbatim (minus control chars)", () => {
    expect(sanitizeDetail("short detail")).toBe("short detail");
  });

  // Post-review regression (C3): control chars beyond CR/LF must also be
  // stripped so the JSONL is safe for line-readers and terminal viewers.
  it("C3: strips NUL bytes (would otherwise corrupt JSONL line-readers)", () => {
    expect(sanitizeDetail("before\x00after")).toBe("before after");
  });

  it("C3: strips tabs and vertical tabs", () => {
    expect(sanitizeDetail("before\tmid\vafter")).toBe("before mid after");
  });

  it("C3: collapses runs of mixed control chars into a single space", () => {
    expect(sanitizeDetail("a\t\n\rb")).toBe("a b");
  });

  it("C3: strips ANSI escape sequences (would otherwise inject terminal control)", () => {
    // ESC = \x1B; the sequence \x1B[2J clears the screen in most terminals.
    expect(sanitizeDetail("approved\x1B[2J")).toBe("approved [2J");
  });

  it("C3: strips C1 control range (\\x7F-\\x9F)", () => {
    expect(sanitizeDetail("a\x7Fb\x9Fc")).toBe("a b c");
  });
});

describe("gateLog.record (R1 provenance-driven write)", () => {
  it("writes decided_by='system' when provenance is dispatch+emulated", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-gates-emulated-"));
    const log = createGateLog(root);

    await log.record({
      gate: "FINAL_ADVERSARIAL_GATE",
      hardness: "HARD",
      phase: "phase-3",
      decision: "pass",
      detail: "emulated adversarial review",
      provenance: { source: "dispatch", dispatchMode: "emulated" },
    });

    const raw = readFileSync(join(root, "gate-decisions.jsonl"), "utf8");
    const entry = JSON.parse(raw.trim());
    expect(entry.decided_by).toBe("system");
    expect(entry.gate).toBe("FINAL_ADVERSARIAL_GATE");
  });

  it("writes decided_by='controller' when provenance is dispatch+real", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-gates-real-"));
    const log = createGateLog(root);

    await log.record({
      gate: "FINAL_ADVERSARIAL_GATE",
      hardness: "HARD",
      phase: "phase-3",
      decision: "pass",
      detail: "real adversarial review",
      provenance: { source: "dispatch", dispatchMode: "real" },
    });

    const raw = readFileSync(join(root, "gate-decisions.jsonl"), "utf8");
    const entry = JSON.parse(raw.trim());
    expect(entry.decided_by).toBe("controller");
  });

  it("sanitizes detail (truncate to MAX_DETAIL_LENGTH + strip control chars) inside record", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-gates-sanitize-"));
    const log = createGateLog(root);

    await log.record({
      gate: "INFO_GATE_BLOCKED",
      hardness: "MANDATORY",
      phase: "phase-0",
      decision: "block",
      detail: `${"a".repeat(250)}\nnewline at end`,
      provenance: { source: "controller" },
    });

    const raw = readFileSync(join(root, "gate-decisions.jsonl"), "utf8");
    const entry = JSON.parse(raw.trim());
    // Use the exported constant — strict equality pins the contract instead
    // of the prior weak `<= 200` bound (QUAL-005).
    expect(entry.detail).toHaveLength(MAX_DETAIL_LENGTH);
    expect(entry.detail).not.toContain("\n");
  });
});

describe("recordGateDecision (top-level convenience)", () => {
  it("routes through createGateLog and writes the entry", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-gates-toplevel-"));

    await recordGateDecision({
      pipelineDocPath: root,
      gate: "INFO_GATE_BLOCKED",
      hardness: "MANDATORY",
      phase: "phase-0",
      decision: "block",
      detail: "missing info",
      provenance: { source: "controller" },
    });

    const raw = readFileSync(join(root, "gate-decisions.jsonl"), "utf8");
    const entry = JSON.parse(raw.trim());
    expect(entry.decided_by).toBe("controller");
    expect(entry.gate).toBe("INFO_GATE_BLOCKED");
  });
});
