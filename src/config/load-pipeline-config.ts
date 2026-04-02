import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";

export interface PipelineConfig {
  source: "local-file" | "package-json" | "conventions" | "defaults";
  workspaceRoot: string;
  docPath: string;
  specPath: string;
  buildCommand: string;
  testCommand: string;
  patternsFile?: string;
}

interface LocalConfigFrontmatter {
  doc_path?: string;
  spec_path?: string;
  build_command?: string;
  test_command?: string;
  patterns_file?: string;
}

function readFirstExistingFile(paths: string[]) {
  for (const path of paths) {
    if (existsSync(path)) {
      return path;
    }
  }

  return undefined;
}

function parseFrontmatter(raw: string): LocalConfigFrontmatter {
  const match = raw.match(/^---\s*[\r\n]+([\s\S]*?)[\r\n]+---/u);
  if (!match) {
    return {};
  }

  try {
    const parsed = YAML.parse(match[1]);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return parsed as LocalConfigFrontmatter;
  } catch {
    return {};
  }
}

function resolveConventionPath(root: string, candidates: string[], fallback: string) {
  const found = readFirstExistingFile(candidates.map((candidate) => join(root, candidate)));
  if (!found) {
    return fallback;
  }

  return found.replace(`${root}\\`, "").replace(`${root}/`, "").replace(/\\/g, "/");
}

function loadPackageJson(root: string) {
  const packageJsonFile = join(root, "package.json");
  if (!existsSync(packageJsonFile)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(readFileSync(packageJsonFile, "utf8")) as {
      scripts?: Record<string, string>;
    };

    return parsed;
  } catch {
    return undefined;
  }
}

export function loadPipelineConfig(root: string): PipelineConfig {
  const localConfigFile = readFirstExistingFile([
    join(root, ".Codex", "pipeline.local.md"),
    join(root, ".codex", "pipeline.local.md"),
  ]);

  if (localConfigFile) {
    const localConfig = parseFrontmatter(readFileSync(localConfigFile, "utf8"));
    if (Object.keys(localConfig).length > 0) {
      return {
        source: "local-file",
        workspaceRoot: root,
        docPath: localConfig.doc_path ?? ".pipeline/docs",
        specPath: localConfig.spec_path ?? "specs",
        buildCommand: localConfig.build_command ?? "npm run build",
        testCommand: localConfig.test_command ?? "npm test",
        patternsFile: localConfig.patterns_file,
      };
    }
  }

  const packageJson = loadPackageJson(root);
  if (packageJson?.scripts?.build || packageJson?.scripts?.test) {
    return {
      source: "package-json",
      workspaceRoot: root,
      docPath: resolveConventionPath(root, ["docs", ".pipeline/docs"], "docs"),
      specPath: resolveConventionPath(root, ["specs", "spec"], "specs"),
      buildCommand: packageJson.scripts?.build ?? "npm run build",
      testCommand: packageJson.scripts?.test ?? "npm test",
      patternsFile: readFirstExistingFile([
        join(root, "PATTERNS.md"),
        join(root, "docs", "PATTERNS.md"),
      ])?.replace(`${root}\\`, "").replace(`${root}/`, "").replace(/\\/g, "/"),
    };
  }

  const docPath = resolveConventionPath(root, ["docs", ".pipeline/docs"], "docs");
  const specPath = resolveConventionPath(root, ["specs", "spec"], "specs");
  const patternsFile = readFirstExistingFile([
    join(root, "PATTERNS.md"),
    join(root, "docs", "PATTERNS.md"),
  ])?.replace(`${root}\\`, "").replace(`${root}/`, "").replace(/\\/g, "/");
  const hasConvention = docPath !== "docs" || specPath !== "specs" || Boolean(patternsFile)
    || existsSync(join(root, "docs"))
    || existsSync(join(root, ".pipeline", "docs"))
    || existsSync(join(root, "specs"))
    || existsSync(join(root, "spec"));

  if (hasConvention) {
    return {
      source: "conventions",
      workspaceRoot: root,
      docPath,
      specPath,
      buildCommand: "npm run build",
      testCommand: "npm test",
      patternsFile,
    };
  }

  return {
    source: "defaults",
    workspaceRoot: root,
    docPath: "docs",
    specPath: "specs",
    buildCommand: "npm run build",
    testCommand: "npm test",
    patternsFile,
  };
}
