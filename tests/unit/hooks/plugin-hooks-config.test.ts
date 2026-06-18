import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("plugin hooks configuration", () => {
  it("ATDD: SessionStart uses command hooks only, never prompt hooks", () => {
    const config = JSON.parse(readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8"));
    const sessionStartHooks = config.hooks.SessionStart.flatMap((entry: any) => entry.hooks);

    expect(sessionStartHooks.length).toBeGreaterThan(0);
    expect(sessionStartHooks.every((hook: any) => hook.type === "command")).toBe(true);
    expect(sessionStartHooks.some((hook: any) => String(hook.command).includes("session-start-context.cjs"))).toBe(true);
  });

  it("TDD: SessionStart command emits JSON context for the host", () => {
    const hook = join(ROOT, "hooks", "session-start-context.cjs");
    const result = spawnSync(process.execPath, [hook], {
      cwd: ROOT,
      input: JSON.stringify({ cwd: ROOT }),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.continue).toBe(true);
    expect(output.additionalContext).toContain("/pipeline-orchestrator-for-codex:pipeline");
    expect(output.additionalContext).toContain("blocked-no-agent-runtime");
  });
});
