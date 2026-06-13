import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const SRC_DIR = join(REPO_ROOT, "src");

const EXEMPT_RELATIVE_PATHS = new Set<string>([
  "state/gate-log.ts",
]);

const WRITE_API_PATTERN =
  /\b(?:appendFile|appendFileSync|writeFile|writeFileSync|createWriteStream)\b/;

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

describe("gate log writer centralization", () => {
  it("forbids direct gate-decisions.jsonl writes outside src/state/gate-log.ts", () => {
    const violations: string[] = [];

    for (const file of walkTsFiles(SRC_DIR)) {
      const relativePath = relative(SRC_DIR, file).replace(/\\/g, "/");
      if (EXEMPT_RELATIVE_PATHS.has(relativePath)) {
        continue;
      }

      const content = readFileSync(file, "utf8");
      if (content.includes("gate-decisions.jsonl") && WRITE_API_PATTERN.test(content)) {
        violations.push(relativePath);
      }
    }

    expect(violations).toEqual([]);
  });

  it("pins the centralized writer as the only append path", () => {
    const writerPath = join(SRC_DIR, "state", "gate-log.ts");
    const content = readFileSync(writerPath, "utf8");

    expect(content).toContain("gate-decisions.jsonl");
    expect(content).toContain("appendFile(file");
  });
});
