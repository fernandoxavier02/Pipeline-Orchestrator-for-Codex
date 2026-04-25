import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { assertPromptInjectionSafe } from "../security/prompt-injection-guard.js";

function isMissingFile(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

const REQUIRED_OUTPUT_BLOCKS: Record<string, string[]> = {
  "controller/pipeline-controller": ["MODE", "TYPE", "COMPLEXITY", "VARIANT", "PROPOSAL"],
  "core/information-gate": ["GATE", "STATUS", "QUESTION"],
  "core/checkpoint-validator": ["CHECKPOINT_RESULT", "STATUS", "EVIDENCE", "NEXT_ACTION"],
  "core/sanity-checker": ["SANITY_CHECK", "STATUS", "EVIDENCE", "NEXT_ACTION"],
  "core/final-validator": ["PA_DE_CAL", "DECISION", "BLOCKERS", "ROLLBACK"],
  "core/sentinel": ["SENTINEL_DECISION", "STATUS", "EXPECTED_NEXT", "ACTION"],
  "executor/executor-fix": ["FIX_RESULT", "CHANGES", "TESTS", "NEXT_ACTION"],
  "executor/executor-spec-reviewer": ["SPEC_REVIEW_RESULT", "STATUS", "EVIDENCE", "NEXT_ACTION"],
  "executor/executor-implementer": ["CHANGES", "TESTS", "RISKS"],
  "quality/quality-gate-router": ["QUALITY_GATE_PLAN", "STATUS", "EVIDENCE", "NEXT_ACTION"],
  "quality/adversarial-reviewer": ["FINDINGS", "SEVERITY", "EVIDENCE", "NEXT_ACTION"],
  "quality/adversarial-quality-reviewer": ["FINDINGS", "SEVERITY", "EVIDENCE", "NEXT_ACTION"],
  "quality/design-interrogator": ["DESIGN_INTERROGATION", "STATUS", "DECISIONS", "QUESTION"],
  "quality/plan-architect": ["IMPLEMENTATION_PLAN", "TASKS", "FILES", "RISKS"],
  "quality/pre-tester": ["PRE_TESTER_RESULT", "STATUS", "EVIDENCE", "NEXT_ACTION"],
  "quality/review-orchestrator": ["STATUS", "FINDINGS", "REVIEWERS", "STRATEGY"],
  "quality/final-adversarial-orchestrator": ["STATUS", "FINDINGS", "REVIEWERS", "STRATEGY"],
  "quality/quality-reviewer": ["FINDINGS", "SEVERITY", "EVIDENCE", "NEXT_ACTION"],
  "quality/security-reviewer": ["FINDINGS", "SEVERITY", "EVIDENCE", "NEXT_ACTION"],
  "quality/architecture-reviewer": ["FINDINGS", "SEVERITY", "EVIDENCE", "NEXT_ACTION"],
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
