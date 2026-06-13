import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const flowMirrorRoot = resolve(__dirname, "../../../references/paperclip/spec/lib");

const canonicalModules = [
  "classify-bridge",
  "grow-tree",
  "measure-fidelity",
  "mirror-fidelity-collector",
  "mirror-fidelity-dictionary",
  "mirror-fidelity-parser",
  "mirror-fidelity-report",
  "mirror-fidelity-score",
  "mirror-fidelity-tree",
  "paperclip-execution-state",
  "tree-factory",
  "tree-factory-io",
  "tree-template",
] as const;

describe("Paperclip flow-mirror inventory", () => {
  it("freezes the canonical Codex flow-mirror module list with paired tests", () => {
    expect(canonicalModules).toHaveLength(13);

    for (const moduleName of canonicalModules) {
      expect(existsSync(join(flowMirrorRoot, `${moduleName}.cjs`)), `${moduleName}.cjs`).toBe(true);
      expect(existsSync(join(flowMirrorRoot, `${moduleName}.test.cjs`)), `${moduleName}.test.cjs`).toBe(true);
    }

    expect(existsSync(join(flowMirrorRoot, "g6-paperclip-flag.test.cjs")), "g6-paperclip-flag.test.cjs").toBe(true);
  });
});
