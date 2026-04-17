// tests/unit/version-consistency.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

describe("version consistency across manifests", () => {
  const pluginJson = readJson(join(ROOT, ".codex-plugin", "plugin.json"));
  const pkgJson = readJson(join(ROOT, "package.json"));
  const hooksJson = readFileSync(join(ROOT, "hooks", "hooks.json"), "utf8");
  const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");

  it("plugin.json version is 1.0.0", () => {
    expect(pluginJson.version).toBe("1.0.0");
  });

  it("package.json version matches plugin.json", () => {
    expect(pkgJson.version).toBe(pluginJson.version);
  });

  it("SessionStart banner mentions v1.0.0", () => {
    expect(hooksJson).toContain("v1.0.0");
  });

  it("CHANGELOG has an entry for 1.0.0", () => {
    expect(changelog).toMatch(/##\s+\[?1\.0\.0\]?/);
  });

  it("CHANGELOG 1.0.0 entry references all 7 gap IDs", () => {
    const gapIds = ["GAP-01", "GAP-02", "GAP-03", "GAP-05", "GAP-06", "GAP-07", "GAP-08"];
    const entry = changelog
      .split(/##\s+\[?1\.0\.0\]?/)[1]
      ?.split(/##\s+\[?0\./)[0] ?? "";
    for (const gap of gapIds) {
      expect(entry).toContain(gap);
    }
  });
});
