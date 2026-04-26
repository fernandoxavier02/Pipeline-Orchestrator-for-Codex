import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type SessionLockStatus = "active" | "expired";

export type SessionLock = Readonly<{
  session_id: string;
  created_at: number;
  expires_at: number;
  status: SessionLockStatus;
}>;

export const SESSION_LOCK_FILENAME = "session-lock.json";
export const DEFAULT_SESSION_LOCK_TTL_SECONDS = 60 * 60;

export function sessionLockPath(root: string): string {
  return join(root, SESSION_LOCK_FILENAME);
}

export function buildSessionLock(input: {
  session_id: string;
  now: number;
  ttl_seconds?: number;
}): SessionLock {
  const ttl = input.ttl_seconds ?? DEFAULT_SESSION_LOCK_TTL_SECONDS;
  if (!Number.isFinite(input.now) || input.now < 0) {
    throw new Error("buildSessionLock: now must be a non-negative finite number");
  }
  if (!Number.isFinite(ttl) || ttl <= 0) {
    throw new Error("buildSessionLock: ttl_seconds must be a positive finite number");
  }
  if (!input.session_id || typeof input.session_id !== "string") {
    throw new Error("buildSessionLock: session_id must be a non-empty string");
  }

  return Object.freeze({
    session_id: input.session_id,
    created_at: input.now,
    expires_at: input.now + ttl,
    status: "active",
  });
}

export function isLockExpired(lock: SessionLock, now: number): boolean {
  return lock.expires_at <= now;
}

export function lockStatus(lock: SessionLock, now: number): SessionLockStatus {
  return isLockExpired(lock, now) ? "expired" : "active";
}

export function parseSessionLock(raw: string): SessionLock {
  const parsed = JSON.parse(raw) as Partial<SessionLock>;
  if (
    typeof parsed.session_id !== "string" ||
    typeof parsed.created_at !== "number" ||
    typeof parsed.expires_at !== "number" ||
    (parsed.status !== "active" && parsed.status !== "expired")
  ) {
    throw new Error("parseSessionLock: malformed session lock payload");
  }
  return Object.freeze({
    session_id: parsed.session_id,
    created_at: parsed.created_at,
    expires_at: parsed.expires_at,
    status: parsed.status,
  });
}

export function readSessionLock(path: string): SessionLock | null {
  if (!existsSync(path)) return null;
  try {
    return parseSessionLock(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function writeSessionLockAtomic(path: string, lock: SessionLock): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(lock), "utf8");
  try {
    unlinkSync(path);
  } catch {
    // ignore: file may not exist
  }
  renameSync(tmp, path);
}

export function deleteSessionLock(path: string): boolean {
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

export type SessionStartSource = "startup" | "resume" | "clear";

export type SessionLockDecision =
  | { kind: "allow"; reason?: string; nextLock?: SessionLock }
  | { kind: "block"; reason: string }
  | { kind: "clear" };

export function decideSessionStart(input: {
  source: SessionStartSource;
  existingLock: SessionLock | null;
  now: number;
  newSessionId: string;
  ttl_seconds?: number;
}): SessionLockDecision {
  const { source, existingLock, now, newSessionId } = input;

  if (source === "clear") {
    return { kind: "clear" };
  }

  if (source === "resume") {
    if (existingLock && !isLockExpired(existingLock, now)) {
      return { kind: "allow", reason: "resume-with-active-lock" };
    }
    return {
      kind: "allow",
      reason: existingLock ? "resume-refresh-expired" : "resume-no-lock",
      nextLock: buildSessionLock({
        session_id: existingLock?.session_id ?? newSessionId,
        now,
        ttl_seconds: input.ttl_seconds,
      }),
    };
  }

  // startup
  if (existingLock && !isLockExpired(existingLock, now)) {
    return {
      kind: "block",
      reason: `session-lock active for session_id=${existingLock.session_id} (expires_at=${existingLock.expires_at})`,
    };
  }

  return {
    kind: "allow",
    reason: existingLock ? "startup-replaced-expired" : "startup-fresh",
    nextLock: buildSessionLock({
      session_id: newSessionId,
      now,
      ttl_seconds: input.ttl_seconds,
    }),
  };
}
