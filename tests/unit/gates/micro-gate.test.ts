import { describe, expect, it } from "vitest";
import { loadReferenceBundle } from "../../../src/references/load-reference-bundle.js";
import { createReferenceProfileIndex } from "../../../src/references/reference-profiles.js";
import { runMicroGate } from "../../../src/gates/micro-gate.js";

describe("micro gate", () => {
  it("routes auth-sensitive session paths to the auth checklist", async () => {
    const bundle = await loadReferenceBundle(process.cwd());
    const index = createReferenceProfileIndex(bundle);

    const result = runMicroGate({
      hasTests: true,
      hasUnresolvedFindings: false,
      touchedPaths: ["src/state/session-store.ts"],
      referenceIndex: index,
    });

    expect(result.checklistIds).toContain("auth");
  });
});
