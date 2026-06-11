import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const provisioner = require("../../../references/paperclip/scripts/provision-pipeline-company.cjs") as {
  ROSTER: Array<[string, string, string[], string, string]>;
  reconcilePayload: (entry: [string, string, string[], string, string], reportsTo: string | null) => {
    adapterType: string;
    adapterConfig: { command: string; cwd: string; instructionsFilePath: string; model: string };
    desiredSkills: string[];
    runtimeConfig: { heartbeat: { enabled: boolean; wakeOnDemand: boolean } };
  };
};

describe("Paperclip provisioner contract", () => {
  it("reconciles existing agents with adapter config, cwd, instructions file, command, and skills", () => {
    const controller = provisioner.ROSTER.find((entry) => entry[0] === "pipeline-controller");
    expect(controller).toBeTruthy();

    const payload = provisioner.reconcilePayload(controller!, null);

    expect(payload.adapterType).toBe("codex_local");
    expect(payload).not.toHaveProperty("permissions");
    expect(payload.adapterConfig.command).toBe("codex");
    expect(payload.adapterConfig.cwd.length).toBeGreaterThan(0);
    expect(payload.adapterConfig.instructionsFilePath).toContain("references");
    expect(payload.adapterConfig.instructionsFilePath).toContain("paperclip");
    expect(payload.adapterConfig.instructionsFilePath).toContain("PAPERCLIP-AXIOMS.md");
    expect(payload.adapterConfig.model).toBe("gpt-5.4");
    expect(payload.runtimeConfig.heartbeat).toMatchObject({
      enabled: false,
      wakeOnDemand: true,
    });
    expect(payload.desiredSkills).toEqual(
      expect.arrayContaining([
        "paperclip",
        "engineering-principles",
        "pipeline-orchestrator-contracts",
        "pipeline-orchestrator-iron-laws",
        "pipeline-orchestrator-classification",
      ]),
    );
  });

  it("uses the Paperclip skills sync endpoint after reconciling existing agents", () => {
    const source = readFileSync(
      resolve(__dirname, "../../../references/paperclip/scripts/provision-pipeline-company.cjs"),
      "utf8",
    );

    expect(source).toContain("/skills/sync?companyId=");
    expect(source).toContain("syncSkills(companyId, id, desiredSkills, name)");
    expect(source).toContain("if (synced) ok++");
  });
});
