import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const HOOK = join(ROOT, "hooks", "dispatch-guard.cjs");
const STEPS_DIR = join(ROOT, "skills", "audit-heavy", "steps");

type HookOutput = {
  hookSpecificOutput?: {
    permissionDecision?: "allow" | "deny" | "ask";
    permissionDecisionReason?: string;
  };
};

function frontmatter(content: string) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/u);
  return match?.[1] ?? "";
}

function scalar(frontmatterText: string, key: string) {
  const match = frontmatterText.match(new RegExp(`^${key}:\\s*(.*)$`, "mu"));
  return match?.[1]?.trim().replace(/^["']|["']$/gu, "");
}

function runDispatchGuard(subagentType: string) {
  const result = spawnSync(process.execPath, [HOOK], {
    cwd: tmpdir(),
    input: JSON.stringify({
      tool_name: "Agent",
      tool_input: {
        subagent_type: subagentType,
      },
    }),
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: ROOT,
    },
  });

  const stdout = result.stdout.trim();
  return {
    status: result.status,
    output: stdout ? JSON.parse(stdout) as HookOutput : {},
  };
}

describe("audit-heavy step dispatch contract", () => {
  it("allows every documented audit-heavy step agent_type through dispatch-guard", () => {
    const stepFiles = readdirSync(STEPS_DIR)
      .filter((entry) => /^\d\d-.*\.md$/u.test(entry))
      .sort();

    expect(stepFiles).toHaveLength(9);

    for (const [index, file] of stepFiles.entries()) {
      const text = readFileSync(join(STEPS_DIR, file), "utf8");
      const fm = frontmatter(text);
      const agentType = scalar(fm, "agent_type");
      const stepNumber = scalar(fm, "step_number");
      const expectedNext = scalar(fm, "expected_next");
      const productionWritesAllowed = scalar(fm, "production_writes_allowed");
      const gateRequired = scalar(fm, "gate_required");

      expect(stepNumber, file).toBe(String(index + 1));
      expect(productionWritesAllowed, file).toBe("false");
      expect(expectedNext, file).toBe(index === 8 ? "null" : String(index + 2));
      expect(gateRequired, file).toBe(index === 0 || index === 8 ? "true" : "false");
      expect(agentType, file).toBeTruthy();

      const result = runDispatchGuard(agentType ?? "");
      expect(result.status, file).toBe(0);
      expect(
        result.output.hookSpecificOutput?.permissionDecision,
        `${file}: ${result.output.hookSpecificOutput?.permissionDecisionReason ?? ""}`,
      ).toBeUndefined();
    }
  });
});
