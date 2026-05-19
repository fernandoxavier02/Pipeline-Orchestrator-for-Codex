import { describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveValidatedRoot } from "../../../src/state/path-validation.js";

describe("resolveValidatedRoot", () => {
  it("rejects paths containing ..", () => {
    expect(() => resolveValidatedRoot("../outside")).toThrow(/SECURITY/);
    expect(() => resolveValidatedRoot(".codex/../../outside")).toThrow(/SECURITY/);
  });

  it("accepts valid state roots", () => {
    const root = resolveValidatedRoot(".codex/pipeline");
    expect(root).toContain(".codex");
  });

  it("accepts absolute paths that do not traverse", () => {
    const tmp = mkdtempSync(join(tmpdir(), "path-validation-"));
    const root = resolveValidatedRoot(tmp);
    expect(root).toBe(realpathSync(resolve(tmp)));
  });
});
