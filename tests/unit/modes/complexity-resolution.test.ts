import { describe, expect, it } from "vitest";
import { resolveExecutionComplexity } from "../../../src/modes/complexity-resolution.js";

describe("resolveExecutionComplexity", () => {
  it("returns explicit complexity when provided", () => {
    expect(resolveExecutionComplexity({ complexity: "SIMPLES" })).toBe("SIMPLES");
    expect(resolveExecutionComplexity({ complexity: "MEDIA" })).toBe("MEDIA");
    expect(resolveExecutionComplexity({ complexity: "COMPLEXA" })).toBe("COMPLEXA");
  });

  it("forces COMPLEXA for --complexa mode", () => {
    expect(resolveExecutionComplexity({ mode: "--complexa" })).toBe("COMPLEXA");
  });

  it("forces COMPLEXA for --plan mode", () => {
    expect(resolveExecutionComplexity({ mode: "--plan" })).toBe("COMPLEXA");
  });

  it("forces SIMPLES for --simples mode", () => {
    expect(resolveExecutionComplexity({ mode: "--simples" })).toBe("SIMPLES");
  });

  it("forces MEDIA for --media mode", () => {
    expect(resolveExecutionComplexity({ mode: "--media" })).toBe("MEDIA");
  });

  it("uses hotfix reduction policy when mode is --hotfix", () => {
    expect(resolveExecutionComplexity({ mode: "--hotfix" })).toBe("COMPLEXA");
  });

  it("defaults to COMPLEXA when variant ends with 'heavy'", () => {
    expect(resolveExecutionComplexity({ variant: "bugfix-heavy" })).toBe("COMPLEXA");
    expect(resolveExecutionComplexity({ variant: "implement-heavy" })).toBe("COMPLEXA");
  });

  it("defaults to MEDIA when no hints are present", () => {
    expect(resolveExecutionComplexity({})).toBe("MEDIA");
    expect(resolveExecutionComplexity({ mode: "--unknown" })).toBe("MEDIA");
  });

  it("explicit complexity overrides mode flags", () => {
    expect(resolveExecutionComplexity({ complexity: "SIMPLES", mode: "--complexa" })).toBe("SIMPLES");
    expect(resolveExecutionComplexity({ complexity: "COMPLEXA", mode: "--simples" })).toBe("COMPLEXA");
  });

  it("explicit complexity overrides variant hint", () => {
    expect(resolveExecutionComplexity({ complexity: "MEDIA", variant: "bugfix-heavy" })).toBe("MEDIA");
  });
});
