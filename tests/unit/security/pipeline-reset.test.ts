import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const RESET_SCRIPT = join(ROOT, "scripts", "pipeline-reset.cjs");

function runReset(cwd: string) {
  return spawnSync(process.execPath, [RESET_SCRIPT], {
    cwd,
    input: "",
    encoding: "utf8",
  });
}

function seedPipelineState(cwd: string) {
  const dir = join(cwd, ".codex", "pipeline");
  const sessions = join(dir, "sessions");
  mkdirSync(sessions, { recursive: true });
  // State files that MUST be removed by reset.
  writeFileSync(join(dir, "workflow-intent.json"), "{}", "utf8");
  writeFileSync(join(dir, "required-first-actions.json"), "{}", "utf8");
  writeFileSync(join(dir, "sentinel-state.json"), "{}", "utf8");
  writeFileSync(join(dir, "session-lock.json"), "{}", "utf8");
  writeFileSync(join(dir, "session.json"), "{}", "utf8");
  writeFileSync(join(sessions, "session-abc.exec-window"), "{}", "utf8");
  // Ledgers / audit that must NEVER be removed.
  writeFileSync(join(dir, "hook-events.jsonl"), "{}\n", "utf8");
  writeFileSync(join(dir, "gate-decisions.jsonl"), "{}\n", "utf8");
  writeFileSync(join(dir, "confidence-score.yaml"), "score: 1\n", "utf8");
  writeFileSync(join(dir, "change-contract.json"), "{}", "utf8");
  mkdirSync(join(dir, "fidelity-reports"), { recursive: true });
  writeFileSync(join(dir, "fidelity-reports", "r1.json"), "{}", "utf8");
  return dir;
}

describe("pipeline-reset.cjs", () => {
  it("removes exactly the canonical state files and exec-windows, preserving ledgers", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-reset-"));
    try {
      const dir = seedPipelineState(cwd);

      const result = runReset(cwd);

      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.status).toBe("RESET");
      expect(Array.isArray(output.removed)).toBe(true);

      // State files gone.
      for (const name of [
        "workflow-intent.json",
        "required-first-actions.json",
        "sentinel-state.json",
        "session-lock.json",
        "session.json",
      ]) {
        expect(existsSync(join(dir, name))).toBe(false);
      }
      expect(existsSync(join(dir, "sessions", "session-abc.exec-window"))).toBe(false);

      // Ledgers preserved.
      expect(existsSync(join(dir, "hook-events.jsonl"))).toBe(true);
      expect(existsSync(join(dir, "gate-decisions.jsonl"))).toBe(true);
      expect(existsSync(join(dir, "confidence-score.yaml"))).toBe(true);
      expect(existsSync(join(dir, "change-contract.json"))).toBe(true);
      expect(existsSync(join(dir, "fidelity-reports", "r1.json"))).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("emits a pipeline_reset hook event before deleting", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-reset-"));
    try {
      seedPipelineState(cwd);

      const result = runReset(cwd);
      expect(result.status).toBe(0);

      const eventsPath = join(cwd, ".codex", "pipeline", "hook-events.jsonl");
      expect(existsSync(eventsPath)).toBe(true);
      const events = readFileSync(eventsPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(events.some((e) => e.event === "pipeline_reset")).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("succeeds (empty RESET) when there is no pipeline state at all", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-reset-"));
    try {
      const result = runReset(cwd);
      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout.trim());
      expect(output.status).toBe("RESET");
      expect(output.removed).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("F6: refuses when .codex resolves outside cwd through a symlink", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-reset-symlink-"));
    const external = mkdtempSync(join(tmpdir(), "pipeline-reset-external-"));
    try {
      // Real external pipeline state we must NOT be able to reach.
      const externalPipeline = join(external, "pipeline");
      mkdirSync(externalPipeline, { recursive: true });
      writeFileSync(join(externalPipeline, "workflow-intent.json"), "{}", "utf8");

      // .codex -> external (intermediate symlink escape).
      try {
        symlinkSync(external, join(cwd, ".codex"), "dir");
      } catch {
        // Symlinks unsupported (Windows without privilege) — skip.
        return;
      }

      const result = runReset(cwd);

      expect(result.status).not.toBe(0);
      // External state left intact.
      expect(existsSync(join(externalPipeline, "workflow-intent.json"))).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(external, { recursive: true, force: true });
    }
  });
});
