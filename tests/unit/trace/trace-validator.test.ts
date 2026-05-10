import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { generateTrace, validateTrace } from "../../../src/trace/trace.js";

describe("v5.2 TRACE.md contract", () => {
  it("generates a schema-versioned trace with canonical sections", () => {
    const trace = generateTrace({
      runId: "001-codex-v5-2-parity",
      classification: {
        type: "Feature",
        complexity: "COMPLEXA",
        variant: "implement-heavy",
      },
      pipeline: {
        mode: "FULL",
        dispatchMode: "real-agent",
      },
      executionLog: [
        "Phase 0: classified",
        "Phase 3: final validator GO",
      ],
      finalVerdict: "GO",
    });

    expect(trace).toContain("trace_schema_version: 1");
    expect(trace).toContain("## Classification");
    expect(trace).toContain("## Pipeline Definition");
    expect(trace).toContain("## Execution Log");
    expect(trace).toContain("## Final Verdict");
    expect(validateTrace(trace)).toMatchObject({ valid: true, errors: [] });
  });

  it("exposes a standalone validator-compatible result", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-trace-"));
    const valid = generateTrace({
      runId: "001-valid",
      classification: { type: "Audit", complexity: "MEDIA", variant: "audit-heavy" },
      pipeline: { mode: "REVIEW-ONLY", dispatchMode: "real-agent" },
      executionLog: ["review completed"],
      finalVerdict: "CONDITIONAL",
    });

    await writeFile(join(root, "TRACE.md"), valid, "utf8");
    const raw = await readFile(join(root, "TRACE.md"), "utf8");

    expect(validateTrace(raw).valid).toBe(true);
    expect(validateTrace("# missing sections").valid).toBe(false);
  });
});
