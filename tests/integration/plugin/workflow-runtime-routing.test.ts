import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPipelineController } from "../../../src/controller/pipeline-controller.js";
import { createPipelineRuntime } from "../../../src/index.js";

async function withTempWorkspace<T>(fn: (root: string) => Promise<T>) {
  const root = await mkdtemp(join(tmpdir(), "pipeline-workflow-routing-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function completeAgentRuntime() {
  return {
    capabilities: { structuredFinalState: true },
    async spawnAgent(request: any) {
      return { mode: "single-agent" as const, role: request.role, output: { status: "approved" } };
    },
    async waitAgent(dispatch: any) {
      return dispatch;
    },
    async collectArtifacts(dispatches: any[]) {
      return dispatches.map((dispatch) => dispatch.output);
    },
  };
}

function stores() {
  return {
    session: { load: async () => undefined, save: async () => undefined },
    checkpoints: { list: async () => [], save: async () => undefined },
    gateLog: { append: async () => undefined, list: async () => [] },
    confidence: { save: async () => undefined },
    sentinel: { save: async () => undefined },
  };
}

describe("workflow runtime routing", () => {
  it("routes direct feature --heavy commands to feature-heavy without UX reclassification", async () => {
    await withTempWorkspace(async (root) => {
      const runtime = createPipelineRuntime({
        cwd: root,
        codexHome: "/codex-home",
        agentRuntime: completeAgentRuntime(),
      });

      const result = await runtime.controller.start(
        "/pipeline-orchestrator-for-codex:feature --heavy add journey-aware lease dashboard workflow",
      );

      expect(result.type).toBe("Feature");
      expect(result.variant).toBe("feature-heavy");
      expect(result.blockedBy).not.toBe("SPEC_ARTIFACT_MISSING");
    });
  });

  it("routes direct bugfix-heavy commands without requiring spec lifecycle artifacts", async () => {
    await withTempWorkspace(async (root) => {
      const controller = createPipelineController({
        workspaceRoot: root,
        stores: stores(),
        agentRuntime: completeAgentRuntime(),
      });

      const result = await controller.start(
        "/pipeline-orchestrator-for-codex:bugfix-heavy fix lease calculation regression",
      );

      expect(result.type).toBe("Bug Fix");
      expect(result.variant).toBe("bugfix-heavy");
      expect(result.blockedBy).not.toBe("SPEC_ARTIFACT_MISSING");
    });
  });

  it("routes spec --audit-only commands without contaminating the spec id with the flag", async () => {
    await withTempWorkspace(async (root) => {
      const controller = createPipelineController({
        workspaceRoot: root,
        stores: stores(),
        agentRuntime: completeAgentRuntime(),
      });

      const result = await controller.start(
        "/pipeline-orchestrator-for-codex:spec --audit-only .kiro/specs/payment-flow",
      );

      expect(result.type).toBe("Spec");
      expect(result.variant).toBe("spec-audit-only");
      expect(result.blockedBy).toBe("SPEC_ARTIFACT_MISSING");
      expect(result.gates.at(-1).specPath.replace(/\\/g, "/")).toContain("/.kiro/specs/payment-flow");
      expect(result.gates.at(-1).specPath).not.toContain("audit-only");
    });
  });

  it("preserves spec-audit-only when reference profiles are loaded by the runtime", async () => {
    await withTempWorkspace(async (root) => {
      const runtime = createPipelineRuntime({
        cwd: root,
        codexHome: "/codex-home",
        agentRuntime: completeAgentRuntime(),
      });

      const result = await runtime.controller.start(
        "/pipeline-orchestrator-for-codex:spec --audit-only .kiro/specs/payment-flow",
      );

      expect(result.type).toBe("Spec");
      expect(result.variant).toBe("spec-audit-only");
      expect(result.blockedBy).toBe("SPEC_ARTIFACT_MISSING");
      expect(result.specPath.replace(/\\/g, "/")).toContain("/.kiro/specs/payment-flow");
    });
  });

  it("uses bundled references when the target workspace has no references directory", async () => {
    await withTempWorkspace(async (root) => {
      const runtime = createPipelineRuntime({ cwd: root, codexHome: "/codex-home" });

      const result = await runtime.controller.start("build lease disclosure dashboard");

      expect(result.type).toBe("Feature");
      expect(result.variant).toBe("feature-light");
    });
  });
});
