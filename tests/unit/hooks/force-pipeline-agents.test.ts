import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const HOOK = join(ROOT, "hooks", "force-pipeline-agents.cjs");

describe("force pipeline agents hook", () => {
  it("records pipeline-worthy prompt decisions as JSONL", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-force-hook-"));

    const result = spawnSync(process.execPath, [HOOK], {
      cwd,
      input: JSON.stringify({
        prompt: "analise este plugin e implemente os gates",
      }),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    const eventsPath = join(cwd, ".codex", "pipeline", "hook-events.jsonl");
    expect(existsSync(eventsPath)).toBe(true);
    const event = JSON.parse(readFileSync(eventsPath, "utf8").trim());
    expect(event).toMatchObject({
      hook: "force-pipeline-agents",
      event: "UserPromptSubmit",
      decision: "inject_pipeline_message",
    });
  });
});
