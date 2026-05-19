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
  "api-platform.md",
  "codex-runtime.md",
  "skills.md",
  "plugins.md",
  "agents-and-subagents.md",
  "mcp-and-connectors.md",
  "rules-hooks-agents-md.md",
  "chatgpt-apps.md",
  "learn-cookbook-patterns.md",
  "source-map.md",
];
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
      const content = await readFile(file, "utf8");
      const fm = extractFrontmatter(content, file);

      for (const field of requiredFields) {
        expect(fm, `${relative(repoRoot, file)} missing ${field}`).toHaveProperty(field);
      }

      expect(typeof fm.title, `${file} title must be a string`).toBe("string");
      expect(typeof fm.kind, `${file} kind must be a string`).toBe("string");
      expect(fm.last_verified, `${file} verification date`).toBe("2026-05-18");
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

  it("indexes every article from INDEX.md", async () => {
    const index = await readFile(join(kbRoot, "INDEX.md"), "utf8");

    for (const article of expectedArticles.filter((name) => name !== "INDEX.md")) {
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
