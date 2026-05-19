import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("governed agent dispatch contract", () => {
  it("uses Codex dispatch requests or spawn_agent instead of legacy Agent({ subagent_type }) calls", () => {
    const executor = readFileSync(join(ROOT, "agents", "executor", "executor-controller.md"), "utf8");

    expect(executor).not.toMatch(/Agent\s*\(\s*\{\s*subagent_type/u);
    expect(executor).not.toMatch(/Use Agent tool with `subagent_type/u);
  });
});
