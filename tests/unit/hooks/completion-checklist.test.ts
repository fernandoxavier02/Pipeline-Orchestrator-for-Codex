import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  REQUIRED_PIPELINE_GATES,
  REQUIRED_PIPELINE_HOOKS,
} from "../../../src/governance/pipeline-contract.js";

const ROOT = process.cwd();
const HOOK = join(ROOT, "hooks", "completion-checklist.cjs");

function runHook(cwd: string, payload: unknown) {
  const result = spawnSync(process.execPath, [HOOK], {
    cwd,
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    encoding: "utf8",
  });

  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

function writeActiveSentinel(cwd: string) {
  const stateDir = join(cwd, ".codex", "pipeline");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    join(stateDir, "sentinel-state.json"),
    JSON.stringify({
      pipelineActive: true,
      currentPhase: "phase-3",
      expectedNext: ["final_verdict"],
    }),
    "utf8",
  );
  return stateDir;
}

function validArtifact() {
  return {
    pipeline_requested: true,
    pipeline_valid: true,
    runtime_mode: "real-agent",
    hook_enforcement_mode: "blocking",
    exec_window_enforcement: "cooperative",
    status: "PASS",
    missing_capabilities: [],
    gates: REQUIRED_PIPELINE_GATES.map((gate) => ({
      gate,
      status: "PASS",
      reason: `${gate} passed.`,
      evidence_ref: `gate:${gate}`,
    })),
    hooks: REQUIRED_PIPELINE_HOOKS.map((checkpoint) => ({
      checkpoint,
      status: "PASS",
      reason: `${checkpoint} recorded.`,
      evidence_ref: `hook:${checkpoint}`,
    })),
    agents: [
      {
        role: "primary_reviewer",
        status: "PASS",
        dispatch_ref: "dispatch:primary",
        independent: true,
      },
      {
        role: "adversarial_reviewer",
        status: "PASS",
        dispatch_ref: "dispatch:adversarial",
        independent: true,
      },
    ],
    manual_fallback_counts_as_pipeline: false,
    final_verdict: {
      status: "PASS",
      reason: "Complete governance ledger.",
      evidence_ref: "final",
    },
  };
}

function writeLedgerProof(
  cwd: string,
  artifact = validArtifact(),
  options: { hookEvents?: boolean; waitEvents?: boolean; dispatchMode?: "real" | "emulated" } = {},
) {
  const stateDir = writeActiveSentinel(cwd);
  const dispatchMode = options.dispatchMode ?? "real";
  writeFileSync(
    join(stateDir, "gate-decisions.jsonl"),
    artifact.gates.map((gate) => JSON.stringify({
      gate: gate.gate,
      decision: "pass",
      status: "PASS",
    })).join("\n") + "\n",
    "utf8",
  );
  writeFileSync(
    join(stateDir, "protocol-events.jsonl"),
    artifact.agents.flatMap((agent) => {
      const dispatchId = agent.dispatch_ref.replace(/^dispatch:/u, "");
      const dispatchEvent = {
        event_id: `dispatch-request-${dispatchId}-completed`,
        kind: "DISPATCH_REQUEST",
        status: "completed",
        dispatchMode,
        payload: {
          dispatchId,
          targetName: agent.role,
        },
      };
      const waitEvent = {
        event_id: `dispatch-request-${dispatchId}-wait-agent-completed`,
        kind: "DISPATCH_REQUEST",
        status: "completed",
        dispatchMode,
        payload: {
          event: "WAIT_AGENT_COMPLETED",
          capability: "wait_agent",
          dispatchId,
          targetName: agent.role,
          targetKind: "agent",
          proof: `wait_agent:${agent.role}`,
        },
      };
      return options.waitEvents === false ? [dispatchEvent] : [dispatchEvent, waitEvent];
    }).map((event) => JSON.stringify(event)).join("\n") + "\n",
    "utf8",
  );
  if (options.hookEvents !== false) {
    writeFileSync(
      join(stateDir, "hook-events.jsonl"),
      artifact.hooks.map((hook) => JSON.stringify({
        hook: "workflow-enforcement",
        event: hook.checkpoint,
        decision: "pass",
        status: "PASS",
        expected: `checkpoint:${hook.checkpoint}`,
        reason: `${hook.checkpoint} observed.`,
      })).join("\n") + "\n",
      "utf8",
    );
  }
  const checkpointsDir = join(stateDir, "checkpoints");
  mkdirSync(checkpointsDir, { recursive: true });
  artifact.hooks.forEach((hook, index) => {
    writeFileSync(
      join(checkpointsDir, `hook-${index}.json`),
      JSON.stringify({
        name: hook.checkpoint,
        status: "completed",
        phase: "phase-3",
        batchIndex: 0,
        timestamp: new Date().toISOString(),
      }),
      "utf8",
    );
  });
}

describe("completion-checklist Stop enforcement", () => {
  it("keeps ordinary stop advisory when no explicit pipeline completion is attempted", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-ordinary-"));

    const output = runHook(cwd, { cwd, output: { text: "ordinary response" } });

    expect(output.continue).toBe(true);
    expect(output.additionalContext).toContain("Checklist de Conclusao");
  });

  it("blocks explicit pipeline completion without a governance artifact", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-block-"));
    writeActiveSentinel(cwd);

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE",
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("PipelineGovernanceArtifact");
    expect(output.stopReason).toContain("gate:CAPABILITY_GATE");
    expect(output.stopReason).toContain("agent:primary_reviewer");
  });

  it("blocks a forged pipeline_valid=true artifact with missing ledgers", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-forged-"));
    writeActiveSentinel(cwd);

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE",
        pipelineGovernanceArtifact: {
          pipeline_requested: true,
          pipeline_valid: true,
          runtime_mode: "real-agent",
          hook_enforcement_mode: "blocking",
          status: "PASS",
          gates: [],
          hooks: [],
          agents: [],
          manual_fallback_counts_as_pipeline: false,
          final_verdict: { status: "PASS" },
        },
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("gate:CAPABILITY_GATE");
    expect(output.stopReason).toContain("hook:intake:before");
    expect(output.stopReason).toContain("agent:adversarial_reviewer");
  });

  it("blocks a complete-looking payload artifact when runtime ledgers do not corroborate it", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-valid-"));
    writeActiveSentinel(cwd);

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE",
        pipelineGovernanceArtifact: validArtifact(),
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("ledger:gate:CAPABILITY_GATE");
    expect(output.stopReason).toContain("ledger:wait_agent:primary_reviewer");
  });

  it("blocks a complete-looking artifact when checkpoint files exist without hook-events", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-missing-hook-events-"));
    const artifact = validArtifact();
    writeLedgerProof(cwd, artifact, { hookEvents: false });

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE",
        pipelineGovernanceArtifact: artifact,
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("ledger:hook:intake:before");
  });

  it("blocks a complete-looking artifact when dispatch completed without wait_agent evidence", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-missing-wait-"));
    const artifact = validArtifact();
    writeLedgerProof(cwd, artifact, { waitEvents: false });

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE",
        pipelineGovernanceArtifact: artifact,
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("ledger:wait_agent:primary_reviewer");
  });

  it("allows explicit pipeline completion with a complete governance artifact and matching ledgers", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-valid-ledger-"));
    const artifact = validArtifact();
    writeLedgerProof(cwd, artifact);

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE",
        pipelineGovernanceArtifact: artifact,
      },
    });

    expect(output.continue).toBe(true);
    expect(output.additionalContext).toContain("Artefato final estruturado");
  });
});
