import { describe, expect, it } from "vitest";
import { parseMode } from "../../../src/controller/parse-mode.js";

describe("Paperclip command parsing", () => {
  it("routes paperclip feature commands through the governed feature workflow", () => {
    const result = parseMode("/pipeline-orchestrator-for-codex:paperclip-feature --complexa build billing workflow");

    expect(result).toEqual({
      mode: "full",
      normalizedRequest: "build billing workflow",
      explicitClassification: {
        type: "Feature",
        complexity: "COMPLEXA",
        variant: "feature-heavy",
      },
    });
  });

  it("routes paperclip bugfix media commands to bugfix light", () => {
    const result = parseMode("/pipeline-orchestrator-for-codex:paperclip-bugfix --media fix mobile login");

    expect(result).toEqual({
      mode: "full",
      normalizedRequest: "fix mobile login",
      explicitClassification: {
        type: "Bug Fix",
        complexity: "MEDIA",
        variant: "bugfix-light",
      },
    });
  });

  it("routes fixed paperclip modes without creating a separate governance path", () => {
    expect(parseMode("/pipeline-orchestrator-for-codex:paperclip-hotfix production outage")).toMatchObject({
      mode: "--hotfix",
      normalizedRequest: "production outage",
      explicitClassification: {
        type: "Bug Fix",
        complexity: "COMPLEXA",
        variant: "bugfix-heavy",
      },
    });

    expect(parseMode("/pipeline-orchestrator-for-codex:paperclip-review")).toEqual({
      mode: "review-only",
      normalizedRequest: "",
    });
  });

  it("routes setup paperclip through the governed feature-heavy workflow", () => {
    expect(parseMode("/pipeline-orchestrator-for-codex:setup-paperclip")).toEqual({
      mode: "full",
      normalizedRequest: "",
      explicitClassification: {
        type: "Feature",
        complexity: "COMPLEXA",
        variant: "feature-heavy",
      },
    });

    expect(parseMode("setup-paperclip")).toEqual({
      mode: "full",
      normalizedRequest: "",
      explicitClassification: {
        type: "Feature",
        complexity: "COMPLEXA",
        variant: "feature-heavy",
      },
    });
  });

  it("keeps simple Paperclip audits diagnostic instead of dispatching cards", () => {
    expect(parseMode("/pipeline-orchestrator-for-codex:paperclip-audit --simples revisar um arquivo")).toEqual({
      mode: "diagnostic",
      normalizedRequest: "revisar um arquivo",
    });
  });

  it("routes Paperclip-only workflow families to existing pipeline variants", () => {
    expect(parseMode("/pipeline-orchestrator-for-codex:paperclip-user-story --simples as a user")).toMatchObject({
      mode: "full",
      normalizedRequest: "as a user",
      explicitClassification: {
        type: "User Story",
        complexity: "MEDIA",
        variant: "user-story-light",
      },
    });

    expect(parseMode("/pipeline-orchestrator-for-codex:paperclip-ux --complexa onboarding journey")).toMatchObject({
      mode: "full",
      normalizedRequest: "onboarding journey",
      explicitClassification: {
        type: "UX Simulation",
        complexity: "COMPLEXA",
        variant: "ux-sim-heavy",
      },
    });

    expect(parseMode("paperclip-ux --media onboarding journey")).toMatchObject({
      mode: "full",
      normalizedRequest: "onboarding journey",
      explicitClassification: {
        type: "UX Simulation",
        complexity: "MEDIA",
        variant: "ux-sim-light",
      },
    });
  });

  it("routes direct user-story and ux-sim families through governed pipeline variants", () => {
    expect(parseMode("/pipeline-orchestrator-for-codex:user-story --simples as a user I want clearer onboarding")).toMatchObject({
      mode: "full",
      normalizedRequest: "as a user I want clearer onboarding",
      explicitClassification: {
        type: "User Story",
        complexity: "MEDIA",
        variant: "user-story-light",
      },
    });

    expect(parseMode("/pipeline-orchestrator-for-codex:ux-sim --complexa onboarding accessibility journey")).toMatchObject({
      mode: "full",
      normalizedRequest: "onboarding accessibility journey",
      explicitClassification: {
        type: "UX Simulation",
        complexity: "COMPLEXA",
        variant: "ux-sim-heavy",
      },
    });
  });
});
