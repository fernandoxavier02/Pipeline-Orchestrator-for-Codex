import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MANDATORY_PLAN_MODE_AGENTS } from "../../src/protocol/plan-mode-bypass.js";

const read = (path: string) => readFileSync(resolve(path), "utf8");

describe("Claude v7.10 parity contracts", () => {
  describe("contract watchdog", () => {
    it("exposes a repeatable watchdog command for the pipeline contracts", () => {
      const pkg = JSON.parse(read("package.json")) as {
        scripts?: Record<string, string>;
      };

      expect(pkg.scripts?.["test:pipeline-contracts"]).toContain("claude-v710-parity.test.ts");
      expect(pkg.scripts?.["test:pipeline-contracts"]).toContain("executor-parity-contract.test.ts");
      expect(pkg.scripts?.["watchdog:pipeline-contracts"]).toContain("pipeline-contract-watchdog.mjs");
    });
  });

  describe("Plan Mode mandatory agents", () => {
    const mandatoryAgents = [
      ["bugfix-diagnostic-agent", "agents/executor/type-specific/bugfix-diagnostic-agent.md"],
      ["bugfix-root-cause-analyzer", "agents/executor/type-specific/bugfix-root-cause-analyzer.md"],
      ["audit-intake", "agents/executor/type-specific/audit-intake.md"],
      ["audit-domain-analyzer", "agents/executor/type-specific/audit-domain-analyzer.md"],
      ["design-interrogator", "agents/quality/design-interrogator.md"],
      ["feature-vertical-slice-planner", "agents/executor/type-specific/feature-vertical-slice-planner.md"],
      ["step-01-explore", "agents/brainstorm/step-01-explore.md"],
      ["executor-implementer-task", "agents/executor/executor-implementer-task.md"],
      ["feature-implementer", "agents/executor/type-specific/feature-implementer.md"],
    ] as const;

    it.each(mandatoryAgents)("%s emits PLAN_MODE_REQUEST before substantive work", (_id, path) => {
      const content = read(path);

      expect(content).toMatch(/(?:Step|Phase) 0.*(?:Plan Mode|PLAN_MODE).*MANDATORY/i);
      expect(content).toContain("PLAN_MODE_REQUEST v1");
      expect(content).toContain("AWAITING_PLAN_MODE_RESULTS");
      expect(content).toContain("PLAN_MODE_RESULTS");
      expect(content).toMatch(/ACHADO #7 RUNTIME PROTOCOL/i);
    });

    it("pipeline-controller enforces PLAN_MODE_BYPASS for the mandatory set", () => {
      const content = read("agents/core/pipeline-controller.md");
      const tableStart = content.indexOf("PLAN_MODE_MANDATORY_AGENTS");
      const tableRegion = content.slice(tableStart, tableStart + 2_000);

      expect(tableStart).toBeGreaterThanOrEqual(0);
      for (const agent of [
        "plan-architect",
        "bugfix-diagnostic-agent",
        "bugfix-root-cause-analyzer",
        "audit-intake",
        "audit-domain-analyzer",
        "design-interrogator",
        "feature-vertical-slice-planner",
        "step-01-explore",
        "executor-implementer-task",
        "feature-implementer",
      ]) {
        expect(tableRegion).toContain(agent);
      }

      expect(content).toContain("PLAN_MODE_BYPASS");
      for (const { outputMarkers } of MANDATORY_PLAN_MODE_AGENTS) {
        for (const marker of outputMarkers) {
          expect(content).toContain(marker);
        }
      }
      expect(content).toMatch(/re-dispatch/i);
    });

    it("keeps mandatory-agent output markers aligned with the runtime registry", () => {
      const content = read("agents/core/pipeline-controller.md");

      for (const { leafName, outputMarkers } of MANDATORY_PLAN_MODE_AGENTS) {
        expect(content).toContain(leafName);
        for (const marker of outputMarkers) {
          expect(content).toContain(marker);
        }
      }
    });
  });

  describe("parallel eligibility and checkpoint attribution", () => {
    it("plan-architect declares batch_metadata.parallel_eligible from CHANGE_CONTRACT overlap", () => {
      const content = read("agents/quality/plan-architect.md");

      expect(content).toMatch(/Step 2b.*Batch Metadata/i);
      expect(content).toContain("parallel_eligible");
      expect(content).toContain("batch_metadata");
      expect(content).toContain("CHANGE_CONTRACT");
      expect(content).toMatch(/analysis cannot be completed/i);
      expect(content).toContain("analysis_incomplete:");
    });

    it("executor-controller uses parallel_eligible but falls back observably when absent", () => {
      const content = read("agents/executor/executor-controller.md");

      expect(content).toMatch(/PARALLEL.*Dispatch|Parallel Dispatch/i);
      expect(content).toContain("parallel_eligible");
      expect(content).toMatch(/spec.*quality.*serial|spec-reviewer.*quality-reviewer.*SERIAL/i);
      expect(content).toMatch(/parallel_eligible.*absent.*undefined/i);
      expect(content).toMatch(/WARN.*parallel_eligible absent/i);
    });

    it("complexity matrix documents disjoint-file parallelism for medium workflows", () => {
      const content = read("references/complexity-matrix.md");

      expect(content).toContain("Parallel tasks");
      expect(content).toMatch(/Parallel.*file-scope disjoint/i);
    });

    it("checkpoint-validator reports per-task status for parallel batches", () => {
      const content = read("agents/core/checkpoint-validator.md");
      const region = content.slice(content.indexOf("batch_task_projection"));

      expect(content).toContain("parallel_execution");
      expect(content).toContain("parallel_execution_actual");
      expect(content).toContain("per_task_status");
      expect(content).toMatch(/parallel_execution: false.*true only when this batch actually used parallel dispatch/is);
      expect(content).toContain("batch_task_projection");
      expect(region).toContain("task_id");
      expect(region).toMatch(/status:.*BATCH_PASS.*BATCH_FAIL/i);
      expect(region).toContain("batch_projection");
      expect(region).toContain("first_failure");
    });
  });

  describe("implementation discipline surface", () => {
    it("exposes the CHANGE_CONTRACT reference and diff-discipline reviewer", () => {
      expect(read("references/implementation-discipline.md")).toContain("CHANGE_CONTRACT");
      expect(read("agents/quality/diff-discipline-reviewer.md")).toContain("Diff Discipline Reviewer");
      const implementer = read("agents/executor/executor-implementer-task.md");
      expect(implementer).toContain("SCOPE LOCK CHECK");
      expect(implementer).toContain("CHANGE_CONTRACT_SCOPE_BLOCK");
    });
  });
});
