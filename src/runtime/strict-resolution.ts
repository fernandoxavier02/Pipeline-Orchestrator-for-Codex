// Spec: pipeline-trust-restoration / R3 — Review Orchestrators Inherit Cascade.
// Single source of truth for the requireRealAgent cascade. Enforces Property
// P2 (Cascade Equivalence) and Domain Invariant DI-3 (Strict Resolution
// Cascade Equivalence) across the three dispatch surfaces:
//
//   - runtimeRunRole         (src/index.ts:548)
//   - Review_Orchestrator    (src/review/review-orchestrator.ts)
//   - Final_Adversarial      (src/review/final-adversarial-orchestrator.ts)
//
// All three sites resolve the same way: request override > strictAgents flag
// > operational-dispatch heuristic. Centralising the cascade prevents the
// historical drift where strictAgents=undefined silently routed adversarial
// review through emulation while runtimeRunRole resolved to true via
// isOperationalPipelineDispatch.

import type { DispatchRequest } from "../dispatcher/dispatcher-types.js";

export function isOperationalPipelineDispatch(request: DispatchRequest): boolean {
  const rawRequestField = request.input?.request;
  // Post-review fix (SEC-004): when `input.request` is present but NOT a
  // string (a buggy caller, a deserialized object, or an adversarial agent
  // response), the previous version silently treated it as empty and returned
  // false — a confused-deputy downgrade that routed operational dispatches
  // through emulation. Now we log a warning to stderr so the caller bug is
  // observable. Behavior unchanged when the field is absent or a string.
  if (rawRequestField !== undefined && typeof rawRequestField !== "string") {
    process.stderr.write(
      `[strict-resolution] isOperationalPipelineDispatch: request.input.request is ${typeof rawRequestField} (expected string) — treating as non-operational.\n`,
    );
    return false;
  }
  const requestText = typeof rawRequestField === "string"
    ? rawRequestField.trim()
    : "";
  if (!requestText.startsWith("/pipeline-orchestrator-for-codex:pipeline")) {
    return false;
  }
  return !requestText.startsWith("/pipeline-orchestrator-for-codex:pipeline diagnostic");
}

export interface StrictResolutionOptions {
  /** Explicit caller override. When `true` or `false`, this value wins. */
  strictAgents?: boolean;
}

/**
 * Resolves whether a given dispatch must use a real agent runtime (vs. the
 * single-agent-runner emulation path).
 *
 * Precedence (R3 cascade):
 *   1. `request.requireRealAgent` — per-dispatch caller override.
 *   2. `options.strictAgents`     — runtime-level flag set by the caller.
 *   3. `isOperationalPipelineDispatch(request)` — operational default
 *      (the production `/pipeline-orchestrator-for-codex:pipeline` invocation
 *      forces real agents; diagnostic mode opts out).
 */
export function resolveRequireRealAgent(
  options: StrictResolutionOptions | undefined,
  request: DispatchRequest,
): boolean {
  return (
    request.requireRealAgent
    ?? options?.strictAgents
    ?? isOperationalPipelineDispatch(request)
  );
}
