import { reductionPolicyForMode } from "./mode-policy.js";
import type { PipelineComplexity } from "../domain/pipeline-types.js";

/**
 * Resolve execution complexity from mode flags, explicit override, or variant hints.
 * Single source of truth for complexity classification across controller and executor.
 */
export function resolveExecutionComplexity(input: {
  mode?: string;
  complexity?: PipelineComplexity;
  variant?: string;
}): PipelineComplexity {
  if (input.complexity) {
    return input.complexity;
  }

  const policy = reductionPolicyForMode(input.mode);
  if (policy) {
    return policy.forcedClassification.complexity;
  }

  if (input.mode === "--complexa" || input.mode === "--plan") {
    return "COMPLEXA";
  }

  if (input.mode === "--simples") {
    return "SIMPLES";
  }

  if (input.mode === "--media") {
    return "MEDIA";
  }

  if (input.variant && input.variant.endsWith("heavy")) {
    return "COMPLEXA";
  }

  return "MEDIA";
}
