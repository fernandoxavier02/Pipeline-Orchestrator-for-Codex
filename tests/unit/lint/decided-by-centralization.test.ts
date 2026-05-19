// Spec: pipeline-trust-restoration / R1 AC 1.4, 1.5 + CI-1 (Gate_Log_Writer Centralization)
// Theme D defense: prevents fix-then-regress by forbidding any new hardcoded
// `decided_by: "<literal>"` value-position assignment outside the centralized
// writer module. The lint allows type declarations (union literals after `:`
// followed by `;` or `|`) and the writer module itself, where the literals
// are intentional and authoritative.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const SRC_DIR = join(REPO_ROOT, "src");

// Files where `decided_by: "<literal>"` is intentional (writer, schema, types).
const EXEMPT_RELATIVE_PATHS = new Set<string>([
  "state/gate-log.ts",     // The single authorized writer; inferDecidedBy returns literals.
  "domain/pipeline-schemas.ts", // Zod enum declaration.
]);

// Pattern: `decided_by: "value",` or `decided_by: "value" as const,`
// Captures assignment-position only (trailing comma / `as const,`).
// Type declarations end with `;`, `|`, or are followed by `}` without comma.
const VALUE_LITERAL_PATTERN =
  /decided_by\s*:\s*["'](controller|user|system|resume-router)["']\s*(?:as\s+const)?\s*,/;

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walkTsFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("decided_by centralization lint (R1 AC 1.4, 1.5 / CI-1)", () => {
  it("forbids hardcoded `decided_by: \"<literal>\"` value assignments outside the centralized writer", () => {
    const files = walkTsFiles(SRC_DIR);
    const violations: string[] = [];

    for (const file of files) {
      const relativePath = relative(SRC_DIR, file).replace(/\\/g, "/");
      if (EXEMPT_RELATIVE_PATHS.has(relativePath)) {
        continue;
      }
      const content = readFileSync(file, "utf8");
      const lines = content.split("\n");
      lines.forEach((line, index) => {
        if (VALUE_LITERAL_PATTERN.test(line)) {
          violations.push(`${relativePath}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it("allows the centralized writer (gate-log.ts) to contain decided_by literals", () => {
    const writerPath = join(SRC_DIR, "state", "gate-log.ts");
    const content = readFileSync(writerPath, "utf8");
    // The writer must return all four DecidedBy literals from inferDecidedBy —
    // sanity check that the centralization point still holds them.
    expect(content).toContain("\"system\"");
    expect(content).toContain("\"controller\"");
    expect(content).toContain("\"user\"");
    expect(content).toContain("\"resume-router\"");
  });
});
