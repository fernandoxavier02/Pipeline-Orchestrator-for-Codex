import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const paperclipRoot = resolve(__dirname, "../../../references/paperclip");
const provisioner = require("../../../references/paperclip/scripts/provision-pipeline-company.cjs") as {
  ROSTER: Array<[string, string, string[], string, string]>;
  SKILL_DIRS: string[];
  desiredSkillsFor: (entry: [string, string, string[], string, string]) => string[];
  isRetryableStatus: (status: number) => boolean;
  shouldRetryRequest: (method: string, status: number) => boolean;
  parseNonNegativeInt: (value: string, fallback: number) => number;
  parsePositiveInt: (value: string, fallback: number) => number;
  api: (method: string, urlPath: string, body?: unknown) => Promise<{ status: number; json: unknown; text: string }>;
  reconcilePayload: (entry: [string, string, string[], string, string], reportsTo: string | null) => {
    adapterType: string;
    adapterConfig: { command: string; cwd: string; instructionsFilePath: string; model: string };
    desiredSkills: string[];
    runtimeConfig: { heartbeat: { enabled: boolean; wakeOnDemand: boolean } };
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Paperclip provisioner contract", () => {
  it("keeps the complete cargo roster and bundled skill inventory exportable", () => {
    expect(provisioner.ROSTER).toHaveLength(47);
    expect(provisioner.ROSTER[0]?.[0]).toBe("pipeline-controller");
    expect(provisioner.SKILL_DIRS).toHaveLength(11);
    expect(new Set(provisioner.SKILL_DIRS).size).toBe(provisioner.SKILL_DIRS.length);

    for (const dir of provisioner.SKILL_DIRS) {
      expect(existsSync(join(paperclipRoot, "skills", dir, "SKILL.md"))).toBe(true);
    }
  });

  it("maps every cargo to workflow instructions and duplicate-free desired skills", () => {
    for (const entry of provisioner.ROSTER) {
      const [, , , workflow] = entry;
      expect(existsSync(join(paperclipRoot, workflow))).toBe(true);

      const desiredSkills = provisioner.desiredSkillsFor(entry);
      expect(desiredSkills[0]).toBe("paperclip");
      expect(desiredSkills).toEqual(expect.arrayContaining([
        "engineering-principles",
        "pipeline-orchestrator-contracts",
        "pipeline-orchestrator-iron-laws",
      ]));
      expect(new Set(desiredSkills).size).toBe(desiredSkills.length);
    }
  });

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

  it("bounds Paperclip API calls with timeout and limited retry policy", () => {
    const source = readFileSync(
      resolve(__dirname, "../../../references/paperclip/scripts/provision-pipeline-company.cjs"),
      "utf8",
    );

    expect(source).toContain("PAPERCLIP_API_TIMEOUT_MS");
    expect(source).toContain("PAPERCLIP_API_RETRY_ATTEMPTS");
    expect(source).toContain("AbortController");
    expect(source).toContain("signal: controller.signal");
    expect(source).toContain("isRetryableStatus");
    expect(provisioner.isRetryableStatus(408)).toBe(true);
    expect(provisioner.isRetryableStatus(429)).toBe(true);
    expect(provisioner.isRetryableStatus(500)).toBe(true);
    expect(provisioner.isRetryableStatus(404)).toBe(false);
    expect(provisioner.shouldRetryRequest("GET", 500)).toBe(true);
    expect(provisioner.shouldRetryRequest("POST", 500)).toBe(false);
    expect(provisioner.shouldRetryRequest("PATCH", 429)).toBe(false);
    expect(provisioner.parsePositiveInt("0", 30_000)).toBe(30_000);
    expect(provisioner.parseNonNegativeInt("-1", 2)).toBe(2);
  });

  it("retries retryable GET responses but never retries mutating POST failures", async () => {
    vi.stubEnv("PAPERCLIP_API_RETRY_ATTEMPTS", "2");
    vi.stubEnv("PAPERCLIP_API_RETRY_BASE_DELAY_MS", "1");

    const getFetch = vi
      .fn()
      .mockResolvedValueOnce({ status: 500, text: async () => '{"error":"transient"}' })
      .mockResolvedValueOnce({ status: 200, text: async () => '[{"id":"company"}]' });
    vi.stubGlobal("fetch", getFetch);

    const getResult = await provisioner.api("GET", "/companies");
    expect(getResult.status).toBe(200);
    expect(getFetch).toHaveBeenCalledTimes(2);

    const postFetch = vi
      .fn()
      .mockResolvedValue({ status: 500, text: async () => '{"error":"processed-maybe"}' });
    vi.stubGlobal("fetch", postFetch);

    const postResult = await provisioner.api("POST", "/companies", { name: "Pipeline Orchestrator" });
    expect(postResult.status).toBe(500);
    expect(postFetch).toHaveBeenCalledTimes(1);
  });

  it("requires every Paperclip heartbeat to leave a machine-detectable disposition", () => {
    const axioms = readFileSync(
      resolve(__dirname, "../../../references/paperclip/PAPERCLIP-AXIOMS.md"),
      "utf8",
    );
    const factory = readFileSync(
      resolve(__dirname, "../../../references/paperclip/spec/lib/tree-factory.cjs"),
      "utf8",
    );

    expect(axioms).toContain("### CONTINUATION_DISPOSITION v1");
    expect(axioms).toContain("successful_run_missing_state");
    expect(axioms).toContain("resumeIntent: true");
    expect(axioms).toContain("resumeFromRunId");
    expect(axioms).toContain("not_done_reason");
    expect(axioms).toContain("Resumo narrativo");
    expect(factory).toContain("PAPERCLIP_CONTINUATION_DISPOSITION_INSTRUCTION");
    expect(factory).toContain("resumeIntent: true");
    expect(factory).toContain("resumeFromRunId");
    expect(factory).toContain("Resumo narrativo sozinho nao conta como continuidade");
  });
});
