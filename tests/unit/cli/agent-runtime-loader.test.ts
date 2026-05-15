import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAgentRuntimeAdapter } from "../../../src/cli/agent-runtime-loader.js";
import { createExecutionIdentity } from "../../../src/observability/execution-identity.js";

async function withTempModule<T>(source: string, fn: (path: string) => Promise<T>) {
  const root = await mkdtemp(join(tmpdir(), "pipeline-agent-runtime-adapter-"));
  try {
    const path = join(root, "adapter.mjs");
    await writeFile(path, source, "utf8");
    return await fn(path);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("agent runtime adapter loader", () => {
  it("loads a Codex spawn_agent adapter for operational CLI execution", async () => {
    await withTempModule(
      `
        export const agentRuntime = {
          async spawnAgent(request) {
            return {
              mode: "single-agent",
              role: request.role,
              output: { receivedRole: request.role, dispatchMode: "real-agent" }
            };
          }
        };
      `,
      async (adapterPath) => {
        const adapter = await loadAgentRuntimeAdapter(adapterPath);

        expect(adapter).toBeDefined();
        const result = await adapter?.spawnAgent({
          role: "pipeline-controller",
          phase: "phase-0",
          prompt: "classify and orchestrate",
          input: { request: "/pipeline-orchestrator-for-codex:pipeline audit" },
          expectedOutput: ["PIPELINE_PROPOSAL"],
          freshContext: true,
          ownership: [],
          reviewOnly: false,
          filesInScope: [],
          authorityLevel: "controller",
          executionIdentity: createExecutionIdentity({
            surface: "dispatch:pipeline-controller",
            source: "real-agent-dispatch",
            timestamp: "2026-05-14T00:00:00.000Z",
          }),
        });

        expect(result?.output).toMatchObject({
          receivedRole: "pipeline-controller",
          dispatchMode: "real-agent",
        });
      },
    );
  });

  it("rejects modules that do not expose spawnAgent", async () => {
    await withTempModule(
      "export default { run() { return 'not an agent runtime'; } };",
      async (adapterPath) => {
        await expect(loadAgentRuntimeAdapter(adapterPath)).rejects.toThrow(
          /spawnAgent function/u,
        );
      },
    );
  });
});
