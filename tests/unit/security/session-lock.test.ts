import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_SESSION_LOCK_TTL_SECONDS,
  buildSessionLock,
  decideSessionStart,
  deleteSessionLock,
  isLockExpired,
  lockStatus,
  parseSessionLock,
  readSessionLock,
  sessionLockPath,
  writeSessionLockAtomic,
} from "../../../src/security/session-lock.js";

function freshRoot(): string {
  return mkdtempSync(join(tmpdir(), "session-lock-"));
}

describe("session-lock value object", () => {
  it("buildSessionLock produces a frozen lock with expires_at = now + ttl", () => {
    const lock = buildSessionLock({ session_id: "S1", now: 1000, ttl_seconds: 600 });
    expect(lock.session_id).toBe("S1");
    expect(lock.created_at).toBe(1000);
    expect(lock.expires_at).toBe(1600);
    expect(lock.status).toBe("active");
    expect(Object.isFrozen(lock)).toBe(true);
  });

  it("buildSessionLock defaults TTL to DEFAULT_SESSION_LOCK_TTL_SECONDS when omitted", () => {
    const lock = buildSessionLock({ session_id: "S1", now: 100 });
    expect(lock.expires_at).toBe(100 + DEFAULT_SESSION_LOCK_TTL_SECONDS);
  });

  it("buildSessionLock rejects invalid inputs", () => {
    expect(() => buildSessionLock({ session_id: "", now: 1 })).toThrow();
    expect(() => buildSessionLock({ session_id: "S1", now: -1 })).toThrow();
    expect(() => buildSessionLock({ session_id: "S1", now: 1, ttl_seconds: 0 })).toThrow();
  });

  it("isLockExpired uses expires_at <= now", () => {
    const lock = buildSessionLock({ session_id: "S1", now: 0, ttl_seconds: 10 });
    expect(isLockExpired(lock, 9)).toBe(false);
    expect(isLockExpired(lock, 10)).toBe(true);
    expect(lockStatus(lock, 9)).toBe("active");
    expect(lockStatus(lock, 10)).toBe("expired");
  });

  it("parseSessionLock rejects malformed payloads", () => {
    expect(() => parseSessionLock("{}")).toThrow();
    expect(() => parseSessionLock("null")).toThrow();
    expect(() =>
      parseSessionLock(JSON.stringify({ session_id: "S", created_at: 1, expires_at: 2, status: "weird" })),
    ).toThrow();
  });
});

describe("session-lock atomic IO", () => {
  it("writeSessionLockAtomic + readSessionLock round-trip", () => {
    const root = freshRoot();
    try {
      const path = sessionLockPath(root);
      const lock = buildSessionLock({ session_id: "abc", now: 42, ttl_seconds: 100 });
      writeSessionLockAtomic(path, lock);
      expect(existsSync(path)).toBe(true);
      const restored = readSessionLock(path);
      expect(restored).toEqual(lock);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writeSessionLockAtomic uses .tmp + rename (no leftover .tmp on success, overwrite-safe)", () => {
    const root = freshRoot();
    try {
      const path = sessionLockPath(root);
      const tmpPath = `${path}.tmp`;
      const first = buildSessionLock({ session_id: "first", now: 1, ttl_seconds: 10 });
      const second = buildSessionLock({ session_id: "second", now: 2, ttl_seconds: 10 });
      writeSessionLockAtomic(path, first);
      writeSessionLockAtomic(path, second);
      expect(existsSync(tmpPath)).toBe(false);
      const stored = JSON.parse(readFileSync(path, "utf8"));
      expect(stored.session_id).toBe("second");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("readSessionLock returns null when file is missing or corrupt", () => {
    const root = freshRoot();
    try {
      const path = sessionLockPath(root);
      expect(readSessionLock(path)).toBeNull();
      writeSessionLockAtomic(path, buildSessionLock({ session_id: "S", now: 1 }));
      // overwrite with garbage
      writeSessionLockAtomic.toString(); // no-op reference
      // Use raw write to corrupt
      // eslint-disable-next-line no-restricted-syntax
      require("node:fs").writeFileSync(path, "{not-json", "utf8");
      expect(readSessionLock(path)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("deleteSessionLock removes the file and returns true; false when absent", () => {
    const root = freshRoot();
    try {
      const path = sessionLockPath(root);
      writeSessionLockAtomic(path, buildSessionLock({ session_id: "S", now: 1 }));
      expect(deleteSessionLock(path)).toBe(true);
      expect(existsSync(path)).toBe(false);
      expect(deleteSessionLock(path)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("decideSessionStart", () => {
  it("startup with no existing lock returns allow + nextLock", () => {
    const decision = decideSessionStart({
      source: "startup",
      existingLock: null,
      now: 100,
      newSessionId: "S1",
      ttl_seconds: 50,
    });
    expect(decision.kind).toBe("allow");
    if (decision.kind === "allow") {
      expect(decision.nextLock?.session_id).toBe("S1");
      expect(decision.nextLock?.expires_at).toBe(150);
    }
  });

  it("startup with active lock blocks", () => {
    const existing = buildSessionLock({ session_id: "S0", now: 0, ttl_seconds: 1000 });
    const decision = decideSessionStart({
      source: "startup",
      existingLock: existing,
      now: 500,
      newSessionId: "S1",
    });
    expect(decision.kind).toBe("block");
    if (decision.kind === "block") {
      expect(decision.reason).toContain("S0");
    }
  });

  it("startup with expired lock allows + replaces", () => {
    const existing = buildSessionLock({ session_id: "S0", now: 0, ttl_seconds: 10 });
    const decision = decideSessionStart({
      source: "startup",
      existingLock: existing,
      now: 100,
      newSessionId: "S1",
      ttl_seconds: 5,
    });
    expect(decision.kind).toBe("allow");
    if (decision.kind === "allow") {
      expect(decision.nextLock?.session_id).toBe("S1");
      expect(decision.reason).toBe("startup-replaced-expired");
    }
  });

  it("resume with active lock allows without writing a new lock", () => {
    const existing = buildSessionLock({ session_id: "S0", now: 0, ttl_seconds: 1000 });
    const decision = decideSessionStart({
      source: "resume",
      existingLock: existing,
      now: 500,
      newSessionId: "ignored",
    });
    expect(decision.kind).toBe("allow");
    if (decision.kind === "allow") {
      expect(decision.nextLock).toBeUndefined();
      expect(decision.reason).toBe("resume-with-active-lock");
    }
  });

  it("resume with expired lock refreshes using prior session_id", () => {
    const existing = buildSessionLock({ session_id: "S0", now: 0, ttl_seconds: 10 });
    const decision = decideSessionStart({
      source: "resume",
      existingLock: existing,
      now: 100,
      newSessionId: "S1",
    });
    expect(decision.kind).toBe("allow");
    if (decision.kind === "allow") {
      expect(decision.nextLock?.session_id).toBe("S0");
    }
  });

  it("clear returns kind=clear", () => {
    const decision = decideSessionStart({
      source: "clear",
      existingLock: null,
      now: 1,
      newSessionId: "S1",
    });
    expect(decision.kind).toBe("clear");
  });
});
