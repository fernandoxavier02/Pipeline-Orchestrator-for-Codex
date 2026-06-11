import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function npmPackDryRunFiles() {
  const npmExecPath = process.env.npm_execpath;
  const result = npmExecPath
    ? spawnSync(process.execPath, [npmExecPath, "pack", "--dry-run", "--json"], {
      cwd: process.cwd(),
      encoding: "utf8",
    })
    : spawnSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: process.cwd(),
      encoding: "utf8",
      shell: process.platform === "win32",
    });

  expect(result.status, result.stderr || result.stdout).toBe(0);
  const parsed = JSON.parse(result.stdout) as Array<{ files: Array<{ path: string }> }>;
  return parsed[0]?.files.map((file) => file.path) ?? [];
}

describe("Paperclip package surface", () => {
  it("packages Paperclip commands and reference contracts for installed Codex clients", { timeout: 30000 }, () => {
    const files = npmPackDryRunFiles();

    expect(files).toContain("commands/paperclip-feature.md");
    expect(files).toContain("commands/paperclip-bugfix.md");
    expect(files).toContain("commands/setup-paperclip.md");
    expect(files).toContain("references/paperclip/spec/lib/grow-tree.cjs");
    expect(files).toContain("references/paperclip/spec/lib/tree-factory.cjs");
    expect(files).toContain("references/paperclip/spec/lib/tree-factory-io.cjs");
    expect(files).toContain("references/paperclip/spec/lib/classify-bridge.cjs");
  });
});
