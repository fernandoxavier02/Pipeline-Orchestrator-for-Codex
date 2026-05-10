import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveSpecIdFromRequest,
  isSpecLifecycleVariant,
  validateSpecAcceptanceTraceability,
  validateSpecContentReviewGate,
  validateSpecLifecycleArtifacts,
} from "../../../src/spec/spec-lifecycle.js";

function freshRoot() {
  return mkdtempSync(join(tmpdir(), "pipeline-spec-lifecycle-"));
}

describe("spec lifecycle artifact validation", () => {
  it("recognizes spec lifecycle variants without changing the public pipeline type enum", () => {
    expect(isSpecLifecycleVariant("spec-light")).toBe(true);
    expect(isSpecLifecycleVariant("spec-heavy")).toBe(true);
    expect(isSpecLifecycleVariant("spec-audit-only")).toBe(true);
    expect(isSpecLifecycleVariant("implement-light")).toBe(false);
  });

  it("derives a stable spec identity from the request instead of scanning any complete spec", () => {
    expect(deriveSpecIdFromRequest("criar spec para fluxo de pagamento")).toBe("fluxo-pagamento");
    expect(deriveSpecIdFromRequest("/pipeline close spec codex harness")).toBe("codex-harness");
  });

  it("blocks when a spec lifecycle flow has no required spec artifacts", () => {
    const root = freshRoot();
    try {
      const result = validateSpecLifecycleArtifacts({
        workspaceRoot: root,
        variant: "spec-light",
        specId: "payment-flow",
      });

      expect(result.status).toBe("blocked");
      expect(result.missingArtifacts).toEqual(["requirements.md", "design.md", "tasks.md"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes when a spec directory contains requirements, design, and tasks", () => {
    const root = freshRoot();
    try {
      const specDir = join(root, ".kiro", "specs", "payment-flow");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "requirements.md"), "# Requirements\n", "utf8");
      writeFileSync(join(specDir, "design.md"), "# Design\n", "utf8");
      writeFileSync(join(specDir, "tasks.md"), "# Tasks\n", "utf8");

      const result = validateSpecLifecycleArtifacts({
        workspaceRoot: root,
        variant: "spec-heavy",
        specId: "payment-flow",
      });

      expect(result.status).toBe("passed");
      expect(result.specPath.replace(/\\/g, "/")).toContain("/.kiro/specs/payment-flow");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("prefers v5.2 pipeline-run spec artifacts before falling back to .kiro specs", () => {
    const root = freshRoot();
    try {
      const specDir = join(root, "pipeline-runs", "001-payment-flow", "01-spec");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "requirements.md"), "# Requirements\n", "utf8");
      writeFileSync(join(specDir, "design.md"), "# Design\n", "utf8");
      writeFileSync(join(specDir, "tasks.md"), "# Tasks\n", "utf8");

      const result = validateSpecLifecycleArtifacts({
        workspaceRoot: root,
        variant: "spec-heavy",
        specId: "001-payment-flow",
      });

      expect(result.status).toBe("passed");
      expect(result.specPath.replace(/\\/g, "/")).toContain("/pipeline-runs/001-payment-flow/01-spec");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks the target spec even when an unrelated spec is complete", () => {
    const root = freshRoot();
    try {
      const unrelated = join(root, ".kiro", "specs", "old-complete-spec");
      const target = join(root, ".kiro", "specs", "payment-flow");
      mkdirSync(unrelated, { recursive: true });
      mkdirSync(target, { recursive: true });
      writeFileSync(join(unrelated, "requirements.md"), "# Requirements\n", "utf8");
      writeFileSync(join(unrelated, "design.md"), "# Design\n", "utf8");
      writeFileSync(join(unrelated, "tasks.md"), "# Tasks\n", "utf8");
      writeFileSync(join(target, "requirements.md"), "# Requirements\n", "utf8");

      const result = validateSpecLifecycleArtifacts({
        workspaceRoot: root,
        variant: "spec-heavy",
        specId: "payment-flow",
      });

      expect(result.status).toBe("blocked");
      expect(result.specPath.replace(/\\/g, "/")).toContain("/.kiro/specs/payment-flow");
      expect(result.missingArtifacts).toEqual(["design.md", "tasks.md"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks acceptance criteria that are not referenced from tasks.md", () => {
    const root = freshRoot();
    try {
      const specDir = join(root, ".kiro", "specs", "payment-flow");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "requirements.md"), [
        "# Requirements",
        "## Critérios de aceite (ATDD)",
        "1. Primeiro critério.",
        "2. Segundo critério.",
      ].join("\n"), "utf8");
      writeFileSync(join(specDir, "tasks.md"), "# Tasks\n\nCobre AC1.\n", "utf8");

      const result = validateSpecAcceptanceTraceability({ specPath: specDir });

      expect(result.status).toBe("blocked");
      expect(result.missingTraceability).toEqual(["AC2"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes when every acceptance criterion has an AC reference in tasks.md", () => {
    const root = freshRoot();
    try {
      const specDir = join(root, ".kiro", "specs", "payment-flow");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "requirements.md"), [
        "# Requirements",
        "## Critérios de aceite (ATDD)",
        "1. Primeiro critério.",
        "2. Segundo critério.",
      ].join("\n"), "utf8");
      writeFileSync(join(specDir, "tasks.md"), "# Tasks\n\nCobre AC1 e AC2.\n", "utf8");

      const result = validateSpecAcceptanceTraceability({ specPath: specDir });

      expect(result.status).toBe("passed");
      expect(result.acceptanceCriteria).toEqual(["AC1", "AC2"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks content review when the explicit spec-content-reviewer artifact is missing", () => {
    const root = freshRoot();
    try {
      const specDir = join(root, ".kiro", "specs", "payment-flow");
      mkdirSync(specDir, { recursive: true });
      writeFileSync(join(specDir, "requirements.md"), "# Requirements\n", "utf8");
      writeFileSync(join(specDir, "design.md"), "# Design\n", "utf8");
      writeFileSync(join(specDir, "tasks.md"), "# Tasks\n", "utf8");

      const result = validateSpecContentReviewGate({ specPath: specDir });

      expect(result.status).toBe("blocked");
      expect(result.detail).toMatch(/Missing explicit spec-content-reviewer/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks content review PASS when evidence is empty", () => {
    const root = freshRoot();
    try {
      const specDir = join(root, ".kiro", "specs", "payment-flow");
      mkdirSync(join(specDir, "reviews"), { recursive: true });
      writeFileSync(join(specDir, "requirements.md"), "# Requirements\n", "utf8");
      writeFileSync(join(specDir, "design.md"), "# Design\n", "utf8");
      writeFileSync(join(specDir, "tasks.md"), "# Tasks\n", "utf8");
      writeFileSync(join(specDir, "reviews", "spec-content-reviewer.json"), JSON.stringify({
        STATUS: "PASS",
        EVIDENCE: [],
      }), "utf8");

      const result = validateSpecContentReviewGate({ specPath: specDir });

      expect(result.status).toBe("blocked");
      expect(result.detail).toMatch(/missing evidence/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
