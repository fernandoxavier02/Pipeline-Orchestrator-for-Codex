import { describe, expect, it } from "vitest";
import { classifyGateHardness } from "../../../src/gates/hardness-policy.js";

describe("hardness policy", () => {
  it("maps missing blocker context to MANDATORY", () => {
    expect(classifyGateHardness({ blocker: true, severity: "high" })).toBe("MANDATORY");
  });

  it("maps non-blocking polish concerns to SOFT", () => {
    expect(classifyGateHardness({ blocker: false, severity: "low" })).toBe("SOFT");
  });
});
