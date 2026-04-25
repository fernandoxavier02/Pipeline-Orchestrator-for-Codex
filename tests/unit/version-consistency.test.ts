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

  it("plugin.json version is 0.4.0", () => {
    expect(pluginJson.version).toBe("0.4.0");
  });

  it("package.json version matches plugin.json", () => {
    expect(pkgJson.version).toBe(pluginJson.version);
  });

  it("SessionStart banner mentions v0.4.0", () => {
    expect(hooksJson).toContain("v0.4.0");
  });

  it("CHANGELOG has entries for 0.4.0 and 0.3.0", () => {
    expect(changelog).toMatch(/##\s+\[?0\.4\.0\]?/);
    expect(changelog).toMatch(/##\s+\[?0\.3\.0\]?/);
  });

  it("CHANGELOG 0.4.0 entry references all 11 batch IDs", () => {
    const batches = [
      "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "B10", "B11",
    ];
    const entry = changelog
      .split(/##\s+\[?0\.4\.0\]?/)[1]
      ?.split(/##\s+\[?0\.3\.0\]?/)[0] ?? "";
    for (const batch of batches) {
      expect(entry).toMatch(new RegExp(`\\b${batch}\\b`));
    }
  });

  it("CHANGELOG 0.4.0 entry names the CC v4.1.0-rc.1 parity target", () => {
    const entry = changelog
      .split(/##\s+\[?0\.4\.0\]?/)[1]
      ?.split(/##\s+\[?0\.3\.0\]?/)[0] ?? "";
    expect(entry).toMatch(/v4\.1\.0-rc\.1/);
  });

  it("CHANGELOG 0.3.0 entry references all 7 gap IDs", () => {
    const gapIds = ["GAP-01", "GAP-02", "GAP-03", "GAP-05", "GAP-06", "GAP-07", "GAP-08"];
    const entry = changelog
      .split(/##\s+\[?0\.3\.0\]?/)[1]
      ?.split(/##\s+\[?0\.2\./)[0] ?? "";
    for (const gap of gapIds) {
      expect(entry).toContain(gap);
    }
  });

  it("CHANGELOG 0.3.0 entry discloses Known Limitations (runtime wiring deferred)", () => {
    const entry = changelog
      .split(/##\s+\[?0\.3\.0\]?/)[1]
      ?.split(/##\s+\[?0\.2\./)[0] ?? "";
    expect(entry).toMatch(/Known Limitations/);
    expect(entry).toMatch(/not yet wired/i);
  });
});
