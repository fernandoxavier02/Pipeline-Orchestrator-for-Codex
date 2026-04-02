import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { assertPromptInjectionSafe } from "../security/prompt-injection-guard.js";

function isMissingFile(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

const REQUIRED_OUTPUT_BLOCKS: Record<string, string[]> = {
  "controller/pipeline-controller": ["MODE", "TYPE", "COMPLEXITY", "VARIANT", "PROPOSAL"],
  "core/information-gate": ["GATE", "STATUS", "QUESTION"],
  "executor/executor-implementer": ["CHANGES", "TESTS", "RISKS"],
  "quality/adversarial-reviewer": ["FINDINGS", "SEVERITY", "EVIDENCE", "NEXT_ACTION"],
};

function normalizePromptName(name: string) {
  return name.replace(/^agents\//u, "").replace(/\\/g, "/");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validateRequiredOutputBlocks(name: string, content: string) {
  const canonicalName = normalizePromptName(name);
  const requiredBlocks = REQUIRED_OUTPUT_BLOCKS[canonicalName];

  if (!requiredBlocks) {
    return;
  }

  if (!/Required output block:/u.test(content)) {
    throw new Error(`Prompt "${canonicalName}" is missing its Required output block contract.`);
  }

  for (const block of requiredBlocks) {
    const matcher = new RegExp(`(^|\\n)-\\s+${escapeRegExp(block)}\\s*(\\n|$)`, "u");
    if (!matcher.test(content)) {
      throw new Error(`Prompt "${canonicalName}" is missing required output block "${block}".`);
    }
  }
}

export function createPromptRegistry(root: string, options?: {
  fallbackRoots?: string[];
}) {
  async function loadPromptFromDisk(name: string) {
    const roots = [root, ...(options?.fallbackRoots ?? [])];

    for (const candidateRoot of roots) {
      const directFile = join(candidateRoot, "prompts", `${name}.md`);

      try {
        return await readFile(directFile, "utf8");
      } catch (error) {
        if (!isMissingFile(error)) {
          throw error;
        }
      }

      const agentFile = join(candidateRoot, "prompts", "agents", `${name}.md`);

      try {
        return await readFile(agentFile, "utf8");
      } catch (error) {
        if (!isMissingFile(error)) {
          throw error;
        }
      }
    }

    throw new Error(`Prompt "${name}" was not found in any configured prompt roots.`);
  }

  return {
    async load(name: string) {
      const content = await loadPromptFromDisk(name);
      const canonicalName = normalizePromptName(name);

      assertPromptInjectionSafe({
        name: canonicalName,
        content,
      });
      validateRequiredOutputBlocks(canonicalName, content);

      return content;
    },
    async preload(names: string[]) {
      for (const name of names) {
        await this.load(name);
      }
    },
  };
}
