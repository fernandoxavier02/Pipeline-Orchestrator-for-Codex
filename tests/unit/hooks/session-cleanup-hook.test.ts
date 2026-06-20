import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const HOOK = join(process.cwd(), "hooks", "session-cleanup-hook.cjs");

function runHook(cwd: string, env: NodeJS.ProcessEnv = {}, payload: Record<string, unknown> = {}) {
  const result = spawnSync(process.execPath, [HOOK], {
    cwd,
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    throw new Error(
      `session-cleanup-hook exited with ${result.status}\nstderr: ${result.stderr}\nstdout: ${result.stdout}`,
    );
  }
  return JSON.parse(result.stdout.trim() || "{}") as { continue?: boolean };
}

function lockPath(root: string) {
  return join(root, ".codex", "pipeline", "session-lock.json");
}

function workflowIntentPath(root: string) {
  return join(root, ".codex", "pipeline", "workflow-intent.json");
}

function requiredFirstActionsPath(root: string) {
  return join(root, ".codex", "pipeline", "required-first-actions.json");
}

function execWindowPath(root: string, sessionId: string) {
  return join(root, ".codex", "pipeline", "sessions", `${sessionId}.exec-window`);
}

function sentinelPath(root: string) {
  return join(root, ".codex", "pipeline", "sentinel-state.json");
}

function fidelityReportPath(root: string) {
  return join(root, ".codex", "pipeline", "fidelity-reports", "trace-1.json");
}

function alternateFidelityReportPath(root: string) {
  return join(root, ".codex", "pipeline", "fidelity-reports", "trace-2.json");
}

function payloadFidelityReportPath(root: string) {
  return join(root, ".codex", "pipeline", "fidelity-reports", "payload-session.json");
}

function unknownFidelityReportPath(root: string) {
  return join(root, ".codex", "pipeline", "fidelity-reports", "unknown-run.json");
}

describe("session-cleanup-hook (B10)", () => {
  let workspace: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "session-cleanup-"));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it("never blocks (always emits continue=true)", () => {
    const out = runHook(workspace);
    expect(out.continue).toBe(true);
  });

  it("removes an expired session-lock", () => {
    mkdirSync(join(workspace, ".codex", "pipeline"), { recursive: true });
    writeFileSync(
      lockPath(workspace),
      JSON.stringify({
        session_id: "S1",
        created_at: 0,
        expires_at: 1,
        status: "active",
      }),
      "utf8",
    );
    runHook(workspace);
    expect(existsSync(lockPath(workspace))).toBe(false);
  });

  it("preserves an active session-lock", () => {
    mkdirSync(join(workspace, ".codex", "pipeline"), { recursive: true });
    const future = Math.floor(Date.now() / 1000) + 3600;
    writeFileSync(
      lockPath(workspace),
      JSON.stringify({
        session_id: "S1",
        created_at: 0,
        expires_at: future,
        status: "active",
      }),
      "utf8",
    );
    runHook(workspace);
    const lock = JSON.parse(readFileSync(lockPath(workspace), "utf8"));
    expect(lock.session_id).toBe("S1");
  });

  it("sweeps expired exec-windows but keeps OPEN ones", () => {
    mkdirSync(join(workspace, ".codex", "pipeline", "sessions"), { recursive: true });
    const future = Math.floor(Date.now() / 1000) + 600;
    writeFileSync(
      execWindowPath(workspace, "OPEN"),
      JSON.stringify({
        session_id: "OPEN",
        opened_at: 0,
        expires_at: future,
        purpose: "p",
        spawning_agent: "pipeline-controller",
      }),
      "utf8",
    );
    writeFileSync(
      execWindowPath(workspace, "EXPIRED"),
      JSON.stringify({
        session_id: "EXPIRED",
        opened_at: 0,
        expires_at: 1,
        purpose: "p",
        spawning_agent: "pipeline-controller",
      }),
      "utf8",
    );
    runHook(workspace);
    expect(existsSync(execWindowPath(workspace, "OPEN"))).toBe(true);
    expect(existsSync(execWindowPath(workspace, "EXPIRED"))).toBe(false);
  });

  it("removes expired workflow obligation files", () => {
    mkdirSync(join(workspace, ".codex", "pipeline"), { recursive: true });
    writeFileSync(
      workflowIntentPath(workspace),
      JSON.stringify({
        status: "active",
        plugin: "pipeline-orchestrator-for-codex",
        expires_at: 1,
      }),
      "utf8",
    );
    writeFileSync(
      requiredFirstActionsPath(workspace),
      JSON.stringify({
        status: "active",
        plugin: "pipeline-orchestrator-for-codex",
        expires_at: 1,
      }),
      "utf8",
    );

    runHook(workspace);

    expect(existsSync(workflowIntentPath(workspace))).toBe(false);
    expect(existsSync(requiredFirstActionsPath(workspace))).toBe(false);
  });

  it("preserves active workflow obligation files", () => {
    mkdirSync(join(workspace, ".codex", "pipeline"), { recursive: true });
    const future = Math.floor(Date.now() / 1000) + 3600;
    writeFileSync(
      workflowIntentPath(workspace),
      JSON.stringify({
        status: "active",
        plugin: "pipeline-orchestrator-for-codex",
        expires_at: future,
      }),
      "utf8",
    );
    writeFileSync(
      requiredFirstActionsPath(workspace),
      JSON.stringify({
        status: "active",
        plugin: "pipeline-orchestrator-for-codex",
        expires_at: future,
      }),
      "utf8",
    );

    runHook(workspace);

    expect(existsSync(workflowIntentPath(workspace))).toBe(true);
    expect(existsSync(requiredFirstActionsPath(workspace))).toBe(true);
  });

  it("preserves malformed workflow obligation files for Stop hook enforcement", () => {
    mkdirSync(join(workspace, ".codex", "pipeline"), { recursive: true });
    writeFileSync(workflowIntentPath(workspace), "{", "utf8");
    writeFileSync(
      requiredFirstActionsPath(workspace),
      JSON.stringify({
        status: "expired",
        plugin: "pipeline-orchestrator-for-codex",
      }),
      "utf8",
    );

    runHook(workspace);

    expect(existsSync(workflowIntentPath(workspace))).toBe(true);
    expect(existsSync(requiredFirstActionsPath(workspace))).toBe(true);
  });

  it("preserves active sentinel state because final-validator owns sentinel finalization", () => {
    mkdirSync(join(workspace, ".codex", "pipeline"), { recursive: true });
    const sentinelState = {
      pipelineActive: true,
      currentPhase: "phase-1",
      currentAgent: "pipeline-controller",
      expectedNext: ["proposal-response"],
      completedPhases: ["phase-0"],
      gateSummary: ["INFO_GATE_OK"],
      batchState: {
        batchIndex: 0,
        status: "awaiting-proposal-confirmation",
      },
      consecutiveCorrections: 0,
      lastCheckpoint: "post_orchestrator",
      updatedAt: "2026-06-11T19:30:25.040Z",
    };
    writeFileSync(sentinelPath(workspace), JSON.stringify(sentinelState), "utf8");

    runHook(workspace);

    expect(readFileSync(sentinelPath(workspace), "utf8")).toBe(JSON.stringify(sentinelState));
  });

  it("removes sentinel state with explicit expired TTL", () => {
    mkdirSync(join(workspace, ".codex", "pipeline"), { recursive: true });
    writeFileSync(
      sentinelPath(workspace),
      JSON.stringify({
        pipelineActive: true,
        run_id: "expired-run",
        session_id: "expired-session",
        expires_at: 1,
      }),
      "utf8",
    );

    runHook(workspace);

    expect(existsSync(sentinelPath(workspace))).toBe(false);
  });

  it("is a no-op when no .codex/pipeline directory exists", () => {
    const out = runHook(workspace);
    expect(out.continue).toBe(true);
  });

  it("writes at most one stop fidelity report per run id", () => {
    const first = runHook(workspace, { CODEX_PIPELINE_TRACE_ID: "trace-1" });
    expect(first.continue).toBe(true);
    expect(existsSync(fidelityReportPath(workspace))).toBe(true);
    const initialReport = readFileSync(fidelityReportPath(workspace), "utf8");

    const second = runHook(workspace, { CODEX_PIPELINE_TRACE_ID: "trace-1" });
    expect(second.continue).toBe(true);
    expect(readFileSync(fidelityReportPath(workspace), "utf8")).toBe(initialReport);

    const third = runHook(workspace, { CODEX_PIPELINE_TRACE_ID: "trace-2" });
    expect(third.continue).toBe(true);
    expect(existsSync(alternateFidelityReportPath(workspace))).toBe(true);

    const events = readFileSync(join(workspace, ".codex", "pipeline", "hook-events.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events).toHaveLength(3);
    expect(events[0].reason).toContain("fidelity-report created=1");
    expect(events[1].reason).toContain("fidelity-report created=0");
    expect(events[2].reason).toContain("fidelity-report created=1");
  });

  it("derives the stop fidelity report run id from the Stop hook payload when env ids are absent", () => {
    const out = runHook(workspace, {}, { session_id: "payload-session" });
    expect(out.continue).toBe(true);

    expect(existsSync(payloadFidelityReportPath(workspace))).toBe(true);
    const report = JSON.parse(readFileSync(payloadFidelityReportPath(workspace), "utf8"));
    expect(report.run_id).toBe("payload-session");
  });

  it("keeps missing-id Stop hook reports idempotent under unknown-run", () => {
    const first = runHook(workspace);
    expect(first.continue).toBe(true);
    expect(existsSync(unknownFidelityReportPath(workspace))).toBe(true);
    const initialReport = readFileSync(unknownFidelityReportPath(workspace), "utf8");

    const second = runHook(workspace);
    expect(second.continue).toBe(true);
    expect(readFileSync(unknownFidelityReportPath(workspace), "utf8")).toBe(initialReport);
  });

  it("does not follow a symlinked fidelity report directory", () => {
    const pipelineDir = join(workspace, ".codex", "pipeline");
    const targetDir = mkdtempSync(join(tmpdir(), "fidelity-symlink-target-"));
    mkdirSync(pipelineDir, { recursive: true });
    symlinkSync(targetDir, join(pipelineDir, "fidelity-reports"), process.platform === "win32" ? "junction" : "dir");

    const out = runHook(workspace, { CODEX_PIPELINE_TRACE_ID: "trace-1" });
    expect(out.continue).toBe(true);

    expect(lstatSync(join(pipelineDir, "fidelity-reports")).isSymbolicLink()).toBe(true);
    expect(existsSync(join(targetDir, "trace-1.json"))).toBe(false);
    rmSync(targetDir, { recursive: true, force: true });
  });
});
