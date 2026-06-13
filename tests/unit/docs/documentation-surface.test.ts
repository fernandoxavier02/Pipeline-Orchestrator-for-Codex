import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

const requiredDocs = [
  "docs/adapter-guide.md",
  "docs/migrations/claude-to-codex.md",
  "docs/diagrams/runtime-surfaces.md",
  "docs/diagrams/runtime-surfaces.html",
  "docs/examples/audit-flow.md",
  "docs/examples/feature-flow.md",
  "docs/examples/spec-flow.md",
];

function readDoc(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

describe("Wave 6B documentation surface", () => {
  it("includes migration, diagram, and example docs in the real repo checkout", () => {
    for (const relativePath of requiredDocs) {
      expect(existsSync(join(repoRoot, relativePath)), relativePath).toBe(true);
      expect(readDoc(relativePath).trim().length, relativePath).toBeGreaterThan(400);
    }
  });

  it("keeps documentation honest about repo-only and runtime boundaries", () => {
    for (const relativePath of requiredDocs) {
      const body = readDoc(relativePath);

      expect(body, relativePath).toMatch(/repo[- ](?:only|level)/i);
      expect(body, relativePath).not.toMatch(/published and active|live plugin execution is proven/i);
    }

    const migrationGuide = readDoc("docs/migrations/claude-to-codex.md");
    expect(migrationGuide).toContain("blocked-no-agent-runtime");
    expect(migrationGuide).toContain("spawn_agent");
    expect(migrationGuide).toContain("wait_agent");

    const adapterGuide = readDoc("docs/adapter-guide.md");
    expect(adapterGuide).toContain("commands/**");
    expect(adapterGuide).toContain("discovery and compatibility shims");
    expect(adapterGuide).toContain("skills/**");

    const runtimeDiagram = readDoc("docs/diagrams/runtime-surfaces.md");
    expect(runtimeDiagram).toContain("flowchart TD");
    expect(runtimeDiagram).toContain("docs/PORTABILITY_CLOSEOUT_V7_12.md");

    const interactiveDiagram = readDoc("docs/diagrams/runtime-surfaces.html");
    expect(interactiveDiagram).toContain("data-surface=\"runtime\"");
    expect(interactiveDiagram).toContain("<details open>");
    expect(interactiveDiagram).toContain("blocked-no-agent-runtime");
  });
});
