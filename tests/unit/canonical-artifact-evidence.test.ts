import { mkdtempSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectCanonicalArtifactEvidence } from "../../src/index.js";

function freshDirs() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "canonical-ws-"));
  const stateDir = join(workspaceRoot, ".codex", "pipeline");
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(join(workspaceRoot, "evals", "telemetry"), { recursive: true });
  return { workspaceRoot, stateDir };
}

describe("collectCanonicalArtifactEvidence", () => {
  it("reports passed=false for missing files", () => {
    const { workspaceRoot, stateDir } = freshDirs();
    try {
      const evidence = collectCanonicalArtifactEvidence({ workspaceRoot, stateDir });
      expect(evidence.every((e) => !e.passed)).toBe(true);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("reports passed=true for genuine non-empty regular files", () => {
    const { workspaceRoot, stateDir } = freshDirs();
    try {
      writeFileSync(join(stateDir, "protocol-events.jsonl"), '{"x":1}\n');
      writeFileSync(join(stateDir, "gate-decisions.jsonl"), '{"x":1}\n');
      writeFileSync(join(workspaceRoot, "evals", "telemetry", "latest_trace.json"), '{}\n');
      const evidence = collectCanonicalArtifactEvidence({ workspaceRoot, stateDir });
      expect(evidence.every((e) => e.passed)).toBe(true);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("REJECTS symlinked evidence even when target is non-empty (anti-forgery)", () => {
    const { workspaceRoot, stateDir } = freshDirs();
    try {
      const decoy = join(workspaceRoot, "decoy.txt");
      writeFileSync(decoy, "non-empty content");
      symlinkSync(decoy, join(stateDir, "protocol-events.jsonl"));
      symlinkSync(decoy, join(stateDir, "gate-decisions.jsonl"));
      symlinkSync(decoy, join(workspaceRoot, "evals", "telemetry", "latest_trace.json"));
      const evidence = collectCanonicalArtifactEvidence({ workspaceRoot, stateDir });
      expect(evidence.every((e) => !e.passed)).toBe(true);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("reports passed=false for empty regular files", () => {
    const { workspaceRoot, stateDir } = freshDirs();
    try {
      writeFileSync(join(stateDir, "protocol-events.jsonl"), "");
      const evidence = collectCanonicalArtifactEvidence({ workspaceRoot, stateDir });
      const proto = evidence.find((e) => e.kind === "protocol-events");
      expect(proto?.passed).toBe(false);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
