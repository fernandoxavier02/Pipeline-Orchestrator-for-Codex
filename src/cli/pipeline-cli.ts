#!/usr/bin/env node
/**
 * CLI entrypoint for pipeline execution in Kimi Code CLI and other environments.
 *
 * Usage:
 *   node dist/src/cli/pipeline-cli.js "<task description>"
 *   node dist/src/cli/pipeline-cli.js --mode=diagnostic "<task>"
 *   node dist/src/cli/pipeline-cli.js --continue
 */

import { createPipelineController } from "../controller/pipeline-controller.js";
import type { RuntimeOptions } from "../domain/pipeline-types.js";

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const options: RuntimeOptions & { mode?: string; task?: string; continue?: boolean } = {
    cwd: process.cwd(),
    codexHome: process.env.CODEX_HOME || process.cwd(),
  };

  let taskParts: string[] = [];

  for (const arg of args) {
    if (arg === "--continue") {
      options.continue = true;
    } else if (arg.startsWith("--mode=")) {
      options.mode = arg.slice("--mode=".length);
    } else if (arg.startsWith("--strict-agents")) {
      options.strictAgents = true;
    } else if (arg.startsWith("--cwd=")) {
      options.cwd = arg.slice("--cwd=".length);
    } else if (!arg.startsWith("-")) {
      taskParts.push(arg);
    }
  }

  options.task = taskParts.join(" ").trim() || undefined;
  return options;
}

async function main() {
  const options = parseArgs(process.argv);

  if (!options.task && !options.continue) {
    console.error("Usage: pipeline-cli <task> [--mode=MODE] [--strict-agents] [--continue]");
    console.error("Modes: full, diagnostic, continue, review-only, --simples, --media, --complexa, --hotfix, --grill, --plan");
    process.exit(1);
  }

  const controller = createPipelineController({
    workspaceRoot: options.cwd,
    strictAgents: options.strictAgents,
  });

  const input = options.continue
    ? "/pipeline continue"
    : options.mode
      ? `/pipeline ${options.mode} ${options.task}`
      : `/pipeline ${options.task}`;

  try {
    const result = await controller.start(input);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result?.status === "blocked" ? 1 : 0);
  } catch (error) {
    console.error("Pipeline execution failed:", error);
    process.exit(1);
  }
}

main();
