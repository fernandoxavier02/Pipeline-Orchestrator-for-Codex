import { describe, expect, it } from "vitest";
import { createPipelineController } from "../../../src/controller/pipeline-controller.js";
import { isExplicitPipelineRequest } from "../../../src/governance/pipeline-contract.js";

function stores() {
  return {
    session: { load: async () => undefined, save: async () => undefined },
    checkpoints: { list: async () => [], save: async () => undefined },
    gateLog: { append: async () => undefined, list: async () => [] },
    confidence: { save: async () => undefined },
    sentinel: { save: async () => undefined },
  };
}

describe("Paperclip capability gate", () => {
  const governedPaperclipEntrypoints = [
    "/pipeline-orchestrator-for-codex:paperclip-audit audit auth",
    "/pipeline-orchestrator-for-codex:paperclip-bugfix fix auth",
    "/pipeline-orchestrator-for-codex:paperclip-feature build reports",
    "/pipeline-orchestrator-for-codex:paperclip-hotfix outage",
    "/pipeline-orchestrator-for-codex:paperclip-review",
    "/pipeline-orchestrator-for-codex:paperclip-spec draft auth",
    "/pipeline-orchestrator-for-codex:paperclip-user-story write story",
    "/pipeline-orchestrator-for-codex:paperclip-ux simulate onboarding",
    "/pipeline-orchestrator-for-codex:setup-paperclip",
    "paperclip-feature build reports",
    "setup-paperclip",
  ];

  it("treats Paperclip entrypoints as explicit governed pipeline requests", () => {
    for (const entrypoint of governedPaperclipEntrypoints) {
      expect(isExplicitPipelineRequest(entrypoint), entrypoint).toBe(true);
    }
    expect(isExplicitPipelineRequest("/pipeline-orchestrator-for-codex:paperclip-overview")).toBe(false);
    expect(isExplicitPipelineRequest("paperclip-overview")).toBe(false);
  });

  it("fails closed before Paperclip routing when runtime capabilities are missing", async () => {
    for (const entrypoint of governedPaperclipEntrypoints) {
      const controller = createPipelineController({
        strictAgents: true,
        stores: stores(),
      });

      const result = await controller.start(entrypoint);

      expect(result, entrypoint).toMatchObject({
        status: "BLOCKED",
        reason: "blocked-no-agent-runtime",
        pipeline_valid: false,
        blockedBy: "CAPABILITY_GATE",
        manual_fallback_counts_as_pipeline: false,
      });
      expect(result.missing_capabilities, entrypoint).toContain("spawn_agent");
      expect(result.gates[0], entrypoint).toMatchObject({
        gate: "CAPABILITY_GATE",
        status: "BLOCKED",
      });
    }
  });
});
