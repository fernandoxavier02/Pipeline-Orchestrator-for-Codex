/**
 * edit-guard — TypeScript dispatcher middleware (NOT a CJS hook).
 *
 * Why a middleware? The Codex PreToolUse schema only types Bash; it does
 * NOT pass tool_input for Edit/Write. So we cannot reliably intercept
 * Edit/Write at the hook layer. Instead we gate the dispatch of write-
 * capable agents: a write-capable role MUST be invoked while a valid
 * exec-window is OPEN. The pipeline-controller opens the window before
 * spawning the executor and closes it after the executor returns.
 */

import {
  type ExecWindow,
  classifyExecWindow,
  type ExecWindowState,
} from "./exec-window.js";
import { readExecWindow, execWindowPath } from "./exec-window-store.js";

export const WRITE_CAPABLE_ROLES: ReadonlySet<string> = new Set([
  "executor-implementer",
  "executor-implementer-task",
  "executor-fix",
  "feature-implementer",
  "bugfix-diagnostic-agent",
]);

export function isWriteCapableRole(role: string): boolean {
  return WRITE_CAPABLE_ROLES.has(role);
}

export class EditGuardBlockedError extends Error {
  readonly code = "edit-guard-blocked";
  readonly windowState: ExecWindowState;
  readonly role: string;
  readonly sessionId: string | undefined;

  constructor(input: {
    role: string;
    windowState: ExecWindowState;
    sessionId?: string;
    detail?: string;
  }) {
    const reason = input.detail ?? `exec-window state=${input.windowState}`;
    super(
      `edit-guard-blocked: write-capable role "${input.role}" was dispatched without an OPEN exec-window (${reason}).`,
    );
    this.name = "EditGuardBlockedError";
    this.windowState = input.windowState;
    this.role = input.role;
    this.sessionId = input.sessionId;
  }
}

export type EditGuardVerdict =
  | { kind: "allow"; reason: "non-write-role" | "open-window" | "guard-disabled" }
  | { kind: "block"; reason: string; windowState: ExecWindowState };

/**
 * Pure decision function. Inputs:
 *   - role: dispatch target
 *   - window: current exec-window snapshot (or null when CLOSED)
 *   - now: current epoch seconds
 *   - sessionId: when provided, must equal window.session_id
 *   - sessionRootProvided: whether the caller wired exec-window state at all
 *     (when false, the guard is disabled — preserves backwards compat for
 *     legacy/test callers that don't manage exec-windows yet).
 */
export function evaluateEditGuard(input: {
  role: string;
  window: ExecWindow | null;
  now: number;
  sessionId?: string;
  sessionRootProvided: boolean;
}): EditGuardVerdict {
  if (!isWriteCapableRole(input.role)) {
    return { kind: "allow", reason: "non-write-role" };
  }
  if (!input.sessionRootProvided) {
    return { kind: "allow", reason: "guard-disabled" };
  }

  const windowState = classifyExecWindow(input.window, input.now);
  if (windowState !== "OPEN") {
    return {
      kind: "block",
      windowState,
      reason:
        windowState === "EXPIRED"
          ? "exec-window EXPIRED — the spawning controller must open a fresh window before retrying."
          : "exec-window CLOSED — write-capable roles require an OPEN window from the spawning controller.",
    };
  }

  if (input.sessionId && input.window && input.window.session_id !== input.sessionId) {
    return {
      kind: "block",
      windowState,
      reason:
        `exec-window session_id=${input.window.session_id} does not match dispatch session_id=${input.sessionId}.`,
    };
  }

  return { kind: "allow", reason: "open-window" };
}

/**
 * Convenience helper: read the current window from disk and ensure write
 * authorization. Throws EditGuardBlockedError when blocked. Used by the
 * dispatcher.
 */
export function ensureWriteAuthorized(input: {
  role: string;
  sessionRoot?: string;
  sessionId?: string;
  now?: number;
}): void {
  const sessionRootProvided = typeof input.sessionRoot === "string" && input.sessionRoot.length > 0;
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const window =
    sessionRootProvided && input.sessionId
      ? readExecWindow(execWindowPath(input.sessionRoot as string, input.sessionId))
      : null;

  const verdict = evaluateEditGuard({
    role: input.role,
    window,
    now,
    sessionId: input.sessionId,
    sessionRootProvided,
  });

  if (verdict.kind === "block") {
    throw new EditGuardBlockedError({
      role: input.role,
      windowState: verdict.windowState,
      sessionId: input.sessionId,
      detail: verdict.reason,
    });
  }
}
