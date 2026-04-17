import type { PlanSession } from "./primitive-types.js";

export interface PlanMode {
  enter(): PlanSession;
  exit(): PlanSession;
  isActive(): boolean;
  currentSession(): PlanSession | null;
  recordWriteAttempt(path: string): void;
}

export function createPlanMode(): PlanMode {
  let session: PlanSession | null = null;

  return {
    enter() {
      session = {
        id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        startTime: new Date().toISOString(),
        readOnly: true,
        writesAttempted: 0,
      };
      return session;
    },

    exit() {
      if (!session) throw new Error("No active plan session to exit");
      const closed: PlanSession = {
        ...session,
        endTime: new Date().toISOString(),
      };
      session = null;
      return closed;
    },

    isActive() {
      return session !== null;
    },

    currentSession() {
      return session;
    },

    recordWriteAttempt(_path: string) {
      if (!session) throw new Error("No active plan session");
      session = { ...session, writesAttempted: session.writesAttempted + 1 };
    },
  };
}
