import type { ReductionPolicy } from "./mode-types.js";
import { hotfixReductionPolicy } from "./hotfix-mode.js";

/**
 * Resolves the reduction policy for a given pipeline mode. Today only
 * `--hotfix` produces a non-null policy; other modes use full validation.
 *
 * B5: this is the single connector that lets pipeline call-sites read
 * field-level reduction decisions (infoGate scope, adversarial
 * checklists, batchSize, ...) from one source of truth instead of
 * scattering `mode === "--hotfix"` literals across the codebase.
 */
export function reductionPolicyForMode(mode: string | undefined): ReductionPolicy | null {
  if (mode === "--hotfix") return hotfixReductionPolicy();
  return null;
}

/**
 * Convenience: true when the runtime should treat the request as a
 * reduced-validation flow (hotfix mode OR explicit validationIntent=reduced).
 */
export function isReducedValidation(input: {
  mode?: string;
  validationIntent?: string;
}): boolean {
  return reductionPolicyForMode(input.mode) !== null || input.validationIntent === "reduced";
}
