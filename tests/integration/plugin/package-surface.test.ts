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

describe("plugin package surface", () => {
  it("ships compiled governance runtime and excludes external audit reports", { timeout: 30000 }, () => {
    const files = npmPackDryRunFiles();

    expect(files).toContain("dist/src/governance/pipeline-contract.js");
    expect(files.some((file) => file.startsWith("security-audit/"))).toBe(false);
    expect(files.some((file) => file.startsWith("evals/telemetry/"))).toBe(false);
  });
});
