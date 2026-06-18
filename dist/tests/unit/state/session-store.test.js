import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGateLog } from "../../../src/state/gate-log.js";
import { createSessionStore } from "../../../src/state/session-store.js";
describe("session store", () => {
    it("persists session state as validated JSON", async () => {
        const root = mkdtempSync(join(tmpdir(), "pipeline-state-"));
        const store = createSessionStore(root);
        await store.save({
            sessionId: "session-1",
            currentPhase: "phase-1",
            mode: "full",
            variant: "implement-heavy",
            confidenceScore: 1,
            proposal: {
                summary: "build new dashboard",
                variant: "implement-light",
                awaitingUserConfirmation: true,
                infoGateStatus: "passed",
                designReviewStatus: "skipped",
                planModeStatus: "skipped",
                affectedFiles: ["src/controller/pipeline-controller.ts"],
                batchSize: 3,
                validationIntent: "standard",
            },
        });
        const raw = readFileSync(join(root, "session.json"), "utf8");
        expect(raw).toContain("\"sessionId\":\"session-1\"");
        expect(raw).toContain("\"execution_identity\"");
        const loaded = await store.load();
        expect(loaded.proposal?.summary).toBe("build new dashboard");
        expect(loaded.execution_identity).toMatchObject({
            plugin_name: "pipeline-orchestrator-for-codex",
            session_id: "session-1",
            surface: "session-store",
            source: "runtime",
        });
    });
    it("shares the workflow trace with gate decisions in the same state root", async () => {
        const root = mkdtempSync(join(tmpdir(), "pipeline-state-correlated-"));
        const store = createSessionStore(root);
        const gateLog = createGateLog(root);
        await store.save({
            sessionId: "session-1",
            currentPhase: "phase-1",
            mode: "full",
            variant: "implement-heavy",
            confidenceScore: 1,
        });
        await gateLog.append({
            gate: "INFO_GATE_BLOCKED",
            hardness: "MANDATORY",
            phase: "phase-0",
            decision: "block",
            decided_by: "controller",
            timestamp: "2026-04-01T12:00:00.000Z",
            detail: "Missing reproduction steps",
            confidence_impact: 0,
        });
        const session = await store.load();
        const [gate] = await gateLog.list();
        expect(gate.execution_identity?.trace_id).toBe(session.execution_identity?.trace_id);
        expect(gate.execution_identity?.event_id).not.toBe(session.execution_identity?.event_id);
    });
    it("preserves run identity when later phase saves omit it", async () => {
        const root = mkdtempSync(join(tmpdir(), "pipeline-state-identity-"));
        const store = createSessionStore(root);
        await store.save({
            sessionId: "session-1",
            run_id: "run-1",
            runtime_mode: "real-agent",
            currentPhase: "phase-1",
            mode: "full",
            variant: "implement-heavy",
            confidenceScore: 1,
        });
        await store.save({
            sessionId: "session-1",
            currentPhase: "phase-2",
            mode: "full",
            variant: "implement-heavy",
            confidenceScore: 1,
        });
        const session = await store.load();
        expect(session.run_id).toBe("run-1");
        expect(session.runtime_mode).toBe("real-agent");
    });
});
