import { describe, expect, it } from "vitest";
import { createExecutionIdentity } from "../../../src/observability/execution-identity.js";

describe("execution identity", () => {
  it("creates a stable trace id for the same execution inputs", () => {
    const first = createExecutionIdentity({
      surface: "dispatch:executor",
      sessionId: "session:with windows-invalid chars",
      cwd: process.cwd(),
      timestamp: "2026-05-07T12:00:00.000Z",
      source: "test",
    });
    const second = createExecutionIdentity({
      surface: "dispatch:executor",
      sessionId: "session:with windows-invalid chars",
      cwd: process.cwd(),
      timestamp: "2026-05-07T12:00:00.000Z",
      source: "test",
    });

    expect(first.trace_id).toBe(second.trace_id);
    expect(first.workflow_id).toBe(first.trace_id);
    expect(first.event_id).toBe(second.event_id);
    expect(first).toMatchObject({
      plugin_name: "pipeline-orchestrator-for-codex",
      plugin_version: "0.5.1",
      surface: "dispatch:executor",
      session_id: "session:with windows-invalid chars",
      source: "test",
    });
  });

  it("keeps the workflow trace stable across surfaces and changes event ids", () => {
    const root = process.cwd();
    const session = createExecutionIdentity({
      surface: "session-store",
      stateRoot: root,
      timestamp: "2026-05-07T12:00:00.000Z",
    });
    const gate = createExecutionIdentity({
      surface: "gate-log",
      stateRoot: root,
      timestamp: "2026-05-07T12:00:01.000Z",
    });

    expect(gate.trace_id).toBe(session.trace_id);
    expect(gate.workflow_id).toBe(session.workflow_id);
    expect(gate.event_id).not.toBe(session.event_id);
  });
});
