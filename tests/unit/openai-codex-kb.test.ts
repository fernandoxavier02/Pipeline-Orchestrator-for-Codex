import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const repoRoot = process.cwd();
const kbRoot = join(repoRoot, "references", "openai-codex-kb");
const requiredFields = [
  "title",
  "kind",
  "topics",
  "source_urls",
  "source_sets",
  "globs",
  "last_verified",
  "status",
] as const;
const expectedArticles = [
  "INDEX.md",
  "CHANGELOG.kb.md",
  "api-platform.md",
  "codex-runtime.md",
  "skills.md",
  "plugins.md",
  "agents-and-subagents.md",
  "mcp-and-connectors.md",
  "plugin-build-guide.md",
  "rules-hooks-agents-md.md",
  "chatgpt-apps.md",
  "learn-cookbook-patterns.md",
  "source-map.md",
];
// Spec: pipeline-trust-restoration / R10 — the 4 drift-noted files plus the
// SSOT and INDEX share a uniform last_verified (2026-05-19) after the
// consolidation. Other articles keep their own dates.
const expectedLastVerified = new Map([
  ["INDEX.md", "2026-05-19"],
  ["plugin-build-guide.md", "2026-05-19"],
  ["plugins.md", "2026-05-19"],
  ["skills.md", "2026-05-19"],
  ["agents-and-subagents.md", "2026-05-19"],
  ["rules-hooks-agents-md.md", "2026-05-19"],
]);
// CHANGELOG.kb.md uses a minimal schema (no kind/topics/source_urls/etc.) — it
// is editorial history, not a topic page. The other-files tests skip it.
const SKIP_SCHEMA_VALIDATION = new Set(["CHANGELOG.kb.md"]);
const requiredSourceSets = ["API Docs", "Codex", "ChatGPT/Apps SDK", "Learn"];
const allowedHosts = new Set([
  "developers.openai.com",
  "platform.openai.com",
  "openai.com",
]);

async function listMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) return listMarkdownFiles(fullPath);
      if (entry.isFile() && entry.name.endsWith(".md")) return [fullPath];
      return [];
    }),
  );

  return nested.flat().sort((left, right) => left.localeCompare(right));
}

function extractFrontmatter(content: string, sourcePath: string): Record<string, unknown> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) throw new Error(`No frontmatter found in ${sourcePath}`);

  const parsed = parseYaml(match[1]);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid frontmatter in ${sourcePath}`);
  }

  return parsed as Record<string, unknown>;
}

function expectStringArray(value: unknown, field: string, sourcePath: string) {
  expect(Array.isArray(value), `${field} must be an array in ${sourcePath}`).toBe(true);
  const items = value as unknown[];
  expect(items.length, `${field} must not be empty in ${sourcePath}`).toBeGreaterThan(0);
  for (const item of items) {
    expect(typeof item, `${field} entries must be strings in ${sourcePath}`).toBe("string");
    expect(String(item).trim(), `${field} entries must not be blank in ${sourcePath}`).not.toBe("");
  }
  return items.map(String);
}

describe("OpenAI Codex knowledge base", () => {
  it("keeps every article discoverable with valid frontmatter and official OpenAI sources", async () => {
    const files = await listMarkdownFiles(kbRoot);
    expect(files.map((file) => relative(kbRoot, file).split(sep).join("/"))).toEqual(
      [...expectedArticles].sort((left, right) => left.localeCompare(right)),
    );

    for (const file of files) {
      const articleName = relative(kbRoot, file).split(sep).join("/");
      const content = await readFile(file, "utf8");
      const fm = extractFrontmatter(content, file);

      if (SKIP_SCHEMA_VALIDATION.has(articleName)) {
        // CHANGELOG.kb.md uses a minimal schema (title + last_verified) — it is
        // editorial history, not a topic page. Only verify last_verified stays
        // consistent with the spec consolidation.
        expect(fm.last_verified, `${file} verification date`).toBe(
          expectedLastVerified.get(articleName) ?? "2026-05-19",
        );
        continue;
      }

      for (const field of requiredFields) {
        expect(fm, `${relative(repoRoot, file)} missing ${field}`).toHaveProperty(field);
      }

      expect(typeof fm.title, `${file} title must be a string`).toBe("string");
      expect(typeof fm.kind, `${file} kind must be a string`).toBe("string");
      expect(fm.last_verified, `${file} verification date`).toBe(
        expectedLastVerified.get(articleName) ?? "2026-05-18",
      );
      expect(fm.status, `${file} status`).toBe("active");

      expectStringArray(fm.topics, "topics", file);
      expectStringArray(fm.source_sets, "source_sets", file);
      expectStringArray(fm.globs, "globs", file);

      for (const rawUrl of expectStringArray(fm.source_urls, "source_urls", file)) {
        const url = new URL(rawUrl);
        expect(
          allowedHosts.has(url.hostname),
          `${rawUrl} must point to an official OpenAI host`,
        ).toBe(true);
      }
    }
  });

  // Spec: pipeline-trust-restoration / R10 AC 10.2 / CI-5 — the 4 drift-noted
  // files plus the SSOT share a uniform last_verified after consolidation.
  it("R10 AC 10.2 / CI-5: drift-consolidated KB files share last_verified=2026-05-19", async () => {
    const consolidatedFiles = [
      "plugins.md",
      "skills.md",
      "agents-and-subagents.md",
      "rules-hooks-agents-md.md",
      "plugin-build-guide.md",
      "INDEX.md",
      "CHANGELOG.kb.md",
    ];
    const dates = new Set<string>();
    for (const name of consolidatedFiles) {
      const content = await readFile(join(kbRoot, name), "utf8");
      const fm = extractFrontmatter(content, name);
      dates.add(String(fm.last_verified));
    }
    expect(dates.size, `consolidated files have inconsistent last_verified: ${[...dates].join(", ")}`).toBe(1);
    expect([...dates][0]).toBe("2026-05-19");
  });

  // R10 AC 10.5 — grep on any of the 4 old files for a corrected schema fact
  // lands on the forward-pointer to CHANGELOG/plugin-build-guide, not on the
  // pre-correction stale text.
  it("R10 AC 10.5: 4 drift-consolidated KB files no longer contain 'Drift Notes' sections", async () => {
    const driftSensitive = [
      "plugins.md",
      "skills.md",
      "agents-and-subagents.md",
      "rules-hooks-agents-md.md",
    ];
    for (const name of driftSensitive) {
      const content = await readFile(join(kbRoot, name), "utf8");
      expect(content, `${name} still contains '## Drift Notes' section`).not.toMatch(
        /^##\s+Drift Notes/m,
      );
      // Forward-pointer to the changelog must be present.
      expect(content, `${name} missing CHANGELOG.kb.md forward-pointer`).toMatch(
        /CHANGELOG\.kb\.md/,
      );
    }
  });

  it("indexes every article from INDEX.md", async () => {
    const index = await readFile(join(kbRoot, "INDEX.md"), "utf8");

    // CHANGELOG.kb.md is editorial history surfaced via forward-pointers on
    // the topic pages; it does not need to live in the INDEX table of topic
    // articles. Skip it from the indexability check.
    const indexable = expectedArticles.filter(
      (name) => name !== "INDEX.md" && name !== "CHANGELOG.kb.md",
    );
    for (const article of indexable) {
      expect(index, `INDEX.md must reference ${article}`).toContain(article);
    }
  });

  it("keeps the source map aligned with the required official source sets", async () => {
    const sourceMap = await readFile(join(kbRoot, "source-map.md"), "utf8");
    const sourceMapFrontmatter = extractFrontmatter(sourceMap, "source-map.md");
    const sourceSets = expectStringArray(sourceMapFrontmatter.source_sets, "source_sets", "source-map.md");

    for (const sourceSet of requiredSourceSets) {
      expect(sourceSets).toContain(sourceSet);
      expect(sourceMap).toContain(`## ${sourceSet}`);
    }

    expect(sourceMap).toContain("https://developers.openai.com/api/docs/llms.txt");
    expect(sourceMap).toContain("https://developers.openai.com/codex/llms.txt");
    expect(sourceMap).toContain("https://developers.openai.com/apps-sdk/llms.txt");
    expect(sourceMap).toContain("https://developers.openai.com/learn/llms.txt");
  });
});
