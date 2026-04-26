/**
 * ExecWindow — DDD value object that represents a time-bounded
 * authorization for a write-capable agent to perform writes in production
 * paths during a controlled execution window.
 *
 * Lifecycle:
 *   OPEN    → file exists AND expires_at > now
 *   CLOSED  → file does not exist (deleted by the controller after the
 *             spawning agent returns).
 *   EXPIRED → file exists but expires_at <= now.
 *
 * Only OPEN windows authorize writes. CLOSED and EXPIRED windows MUST be
 * treated as no-authorization.
 */

export const DEFAULT_EXEC_WINDOW_TTL_SECONDS = 5 * 60;
export const MAX_EXEC_WINDOW_TTL_SECONDS = 60 * 60;

export type ExecWindowState = "OPEN" | "CLOSED" | "EXPIRED";

export type ExecWindow = Readonly<{
  session_id: string;
  opened_at: number;
  expires_at: number;
  purpose: string;
  spawning_agent: string;
}>;

export function buildExecWindow(input: {
  session_id: string;
  now: number;
  ttl_seconds?: number;
  purpose: string;
  spawning_agent: string;
}): ExecWindow {
  if (!input.session_id) throw new Error("buildExecWindow: session_id is required");
  if (!input.purpose) throw new Error("buildExecWindow: purpose is required");
  if (!input.spawning_agent) throw new Error("buildExecWindow: spawning_agent is required");
  if (!Number.isFinite(input.now) || input.now < 0) {
    throw new Error("buildExecWindow: now must be a non-negative finite number");
  }
  const ttl = input.ttl_seconds ?? DEFAULT_EXEC_WINDOW_TTL_SECONDS;
  if (!Number.isFinite(ttl) || ttl <= 0) {
    throw new Error("buildExecWindow: ttl_seconds must be > 0");
  }
  if (ttl > MAX_EXEC_WINDOW_TTL_SECONDS) {
    throw new Error(
      `buildExecWindow: ttl_seconds ${ttl} exceeds MAX_EXEC_WINDOW_TTL_SECONDS=${MAX_EXEC_WINDOW_TTL_SECONDS}`,
    );
  }
  return Object.freeze({
    session_id: input.session_id,
    opened_at: input.now,
    expires_at: input.now + ttl,
    purpose: input.purpose,
    spawning_agent: input.spawning_agent,
  });
}

export function classifyExecWindow(window: ExecWindow | null, now: number): ExecWindowState {
  if (!window) return "CLOSED";
  return window.expires_at > now ? "OPEN" : "EXPIRED";
}

export function isOpen(window: ExecWindow | null, now: number): boolean {
  return classifyExecWindow(window, now) === "OPEN";
}

export function parseExecWindow(raw: string): ExecWindow {
  const parsed = JSON.parse(raw) as Partial<ExecWindow>;
  if (
    typeof parsed.session_id !== "string" ||
    typeof parsed.opened_at !== "number" ||
    typeof parsed.expires_at !== "number" ||
    typeof parsed.purpose !== "string" ||
    typeof parsed.spawning_agent !== "string"
  ) {
    throw new Error("parseExecWindow: malformed exec-window payload");
  }
  return Object.freeze({
    session_id: parsed.session_id,
    opened_at: parsed.opened_at,
    expires_at: parsed.expires_at,
    purpose: parsed.purpose,
    spawning_agent: parsed.spawning_agent,
  });
}
