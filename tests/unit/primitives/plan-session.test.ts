import { describe, it, expect } from "vitest";
import { createPlanMode } from "../../../src/primitives/plan-session.js";

describe("plan-session emulator (formerly primitives/plan-mode)", () => {
  it("starts a read-only session", () => {
    const pm = createPlanMode();
    const session = pm.enter();
    expect(session.readOnly).toBe(true);
    expect(session.writesAttempted).toBe(0);
    expect(pm.isActive()).toBe(true);
  });

  it("counts writes attempted but does not block (observability layer)", () => {
    const pm = createPlanMode();
    pm.enter();
    pm.recordWriteAttempt("docs/plan.md");
    pm.recordWriteAttempt("src/foo.ts");
    expect(pm.currentSession()?.writesAttempted).toBe(2);
  });

  it("exit returns the session with endTime set and deactivates guard", () => {
    const pm = createPlanMode();
    pm.enter();
    const session = pm.exit();
    expect(session.endTime).toBeDefined();
    expect(pm.isActive()).toBe(false);
  });

  it("throws when recordWriteAttempt called without active session", () => {
    const pm = createPlanMode();
    expect(() => pm.recordWriteAttempt("foo.ts")).toThrow(/no active plan session/i);
  });

  it("throws when exit called without active session", () => {
    const pm = createPlanMode();
    expect(() => pm.exit()).toThrow(/no active plan session/i);
  });
});
