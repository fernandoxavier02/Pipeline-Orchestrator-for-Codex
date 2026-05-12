import { describe, expect, it } from "vitest";
import { createPipelineController } from "../../src/controller/pipeline-controller.js";

describe("state adapter integration", () => {
  describe("thin wrapper behavior", () => {
    it("returns blocked-no-agent-runtime when strictAgents is true and no executionController is provided", async () => {
      const controller = createPipelineController({
        strictAgents: true,
        stores: {
          session: { load: async () => undefined },
          checkpoints: { list: async () => [] },
        },
      });

      const result = await controller.start("fix login bug");

      expect(result.status).toBe("blocked-no-agent-runtime");
      expect(result.reason).toContain("spawn_agent is not available");
    });

    it("uses fallback when strictAgents is false", async () => {
      const controller = createPipelineController({
        strictAgents: false,
        stores: {
          session: { load: async () => undefined },
          checkpoints: { list: async () => [] },
        },
      });

      const result = await controller.start("fix login bug");

      expect(result.status).not.toBe("blocked-no-agent-runtime");
      expect(result.proposal).toBeDefined();
    });

    it("uses fallback when strictAgents is true BUT executionController is provided", async () => {
      const controller = createPipelineController({
        strictAgents: true,
        stores: {
          session: { load: async () => undefined },
          checkpoints: { list: async () => [] },
        },
        executionController: {
          executeApprovedWork: async () => ({ status: "completed" }),
        },
      });

      const result = await controller.start("fix login bug");

      expect(result.status).not.toBe("blocked-no-agent-runtime");
      expect(result.proposal).toBeDefined();
    });
  });

  describe("state adapter persistence via controller", () => {
    it("persists session state through the controller's internal adapter", async () => {
      let savedSession: unknown;
      const controller = createPipelineController({
        stores: {
          session: {
            load: async () => undefined,
            save: async (session) => {
              savedSession = session;
            },
          },
          checkpoints: { list: async () => [] },
        },
      });

      await controller.start("fix login bug");

      expect(savedSession).toBeDefined();
      expect((savedSession as any).proposal).toBeDefined();
    });
  });
});
