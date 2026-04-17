// tests/unit/agents-inventory.test.ts
// Locks in the INTENTIONAL split between agents/ (reference docs) and prompts/agents/ (runtime stubs).
// Both directories must exist with the expected file counts. Any future "consolidation" that
// collapses them must update this test AND update prompt-registry.ts + src/index.ts role resolver.
import { describe, it, expect } from "vitest";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const AGENTS_QUALITY = join(ROOT, "agents", "quality");
const PROMPTS_AGENTS_QUALITY = join(ROOT, "prompts", "agents", "quality");

describe("agents/ vs prompts/agents/ — intentional split", () => {
  it("agents/README.md exists and documents the reference-docs role", () => {
    const readme = join(ROOT, "agents", "README.md");
    expect(existsSync(readme)).toBe(true);
    const content = readFileSync(readme, "utf8");
    expect(content).toMatch(/Reference Documentation/i);
    expect(content).toMatch(/NOT loaded by the runtime/i);
  });

  it("prompts/README.md exists and documents the runtime-stubs role", () => {
    const readme = join(ROOT, "prompts", "README.md");
    expect(existsSync(readme)).toBe(true);
    const content = readFileSync(readme, "utf8");
    expect(content).toMatch(/Runtime Stubs/i);
    expect(content).toMatch(/prompt-registry\.ts/);
  });

  it("agents/quality/ has at least 7 reference docs (CC-style rich)", () => {
    const files = readdirSync(AGENTS_QUALITY).filter((f) => f.endsWith(".md"));
    expect(files.length).toBeGreaterThanOrEqual(7);
    // Sample one to confirm it's rich, not a stub
    const sample = readFileSync(join(AGENTS_QUALITY, "architecture-reviewer.md"), "utf8");
    expect(sample.length).toBeGreaterThan(500); // stubs are ~300 chars; rich docs are 4000+
  });

  it("prompts/agents/quality/ has runtime stubs for every role resolved to quality/", () => {
    const files = readdirSync(PROMPTS_AGENTS_QUALITY).filter((f) => f.endsWith(".md"));
    // Must have stubs for every role that prompt-registry.ts registers under quality/
    const requiredStubs = [
      "architecture-reviewer.md",
      "adversarial-reviewer.md",
      "design-interrogator.md",
      "final-adversarial-orchestrator.md",
      "plan-architect.md",
      "pre-tester.md",
      "quality-gate-router.md",
      "quality-reviewer.md",
      "review-orchestrator.md",
      "security-reviewer.md",
    ];
    for (const stub of requiredStubs) {
      expect(files).toContain(stub);
    }
    // And verify they are actually stubs (short)
    const sample = readFileSync(join(PROMPTS_AGENTS_QUALITY, "quality-reviewer.md"), "utf8");
    expect(sample.length).toBeLessThan(1000); // stubs are intentionally short
  });

  it("prompt-registry.ts references exactly the stubs that exist", () => {
    const registry = readFileSync(join(ROOT, "src", "prompts", "prompt-registry.ts"), "utf8");
    // Every "quality/<name>" key must have a matching file in prompts/agents/quality/
    const matches = Array.from(registry.matchAll(/"quality\/([a-z-]+)":/g));
    const registeredRoles = matches.map((m) => m[1]);
    const stubFiles = readdirSync(PROMPTS_AGENTS_QUALITY)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""));
    const ghostRoles = registeredRoles.filter((r) => !stubFiles.includes(r));
    expect(ghostRoles).toEqual([]);
  });
});
