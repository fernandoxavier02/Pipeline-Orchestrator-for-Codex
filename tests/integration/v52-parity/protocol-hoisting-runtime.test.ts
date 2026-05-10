import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPipelineRuntime } from "../../../src/index.js";
import * as dispatchRunRoleModule from "../../../src/dispatcher/run-role.js";
import { createExecutionIdentity } from "../../../src/observability/execution-identity.js";

describe("v5.2 protocol hoisting runtime", () => {
  it("persists documented protocol blocks emitted by a dispatched role", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-protocol-runtime-"));
    const runtime = createPipelineRuntime({
      cwd: root,
      codexHome: "/codex-home",
    });
    const executionIdentity = createExecutionIdentity({
      surface: "test",
      cwd: root,
      stateRoot: runtime.stateDir,
      source: "test",
    });
    const runRoleSpy = vi.spyOn(dispatchRunRoleModule, "runRole").mockResolvedValue({
      mode: "single-agent",
      role: "brainstorm-controller",
      executionIdentity,
      output: {
        text: `=== GATE_REQUEST v1 ===
gate_id: brainstorm-explore-q1
question: What is the scope?
header: Scope
options:
  - label: Narrow
    description: Keep the first batch small.
    recommended: true
=== END GATE_REQUEST ===`,
        executionIdentity,
      },
    });

    try {
      const result = await runtime.dispatcher.runRole({
        mode: "single-agent",
        role: "brainstorm-controller",
        prompt: "Run brainstorm.",
        input: {},
      });

      expect(result.output.protocolStatus).toBe("awaiting-parent-action");
      expect(result.output.protocolEvents).toEqual([
        { kind: "GATE_REQUEST", id: "brainstorm-explore-q1" },
      ]);
      const raw = await readFile(join(runtime.stateDir, "protocol-events.jsonl"), "utf8");
      expect(raw).toContain("\"kind\":\"GATE_REQUEST\"");
      expect(raw).toContain("\"gate_id\":\"brainstorm-explore-q1\"");
    } finally {
      runRoleSpy.mockRestore();
    }
  });
});
