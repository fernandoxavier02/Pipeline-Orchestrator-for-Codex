import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  REQUIRED_PIPELINE_CAPABILITIES,
  REQUIRED_PIPELINE_GATES,
  REQUIRED_PIPELINE_HOOKS,
} from "../../../src/governance/pipeline-contract.js";

const ROOT = process.cwd();
const HOOK = join(ROOT, "hooks", "completion-checklist.cjs");
const TEST_HMAC_KEY = "completion-checklist-test-key";

type TestGateArtifact = {
  gate: string;
  status: string;
  reason: string;
  evidence_ref: string;
};

type TestHookArtifact = {
  checkpoint: string;
  status: string;
  reason: string;
  evidence_ref: string;
};

type TestAgentArtifact = {
  role: string;
  status: string;
  dispatch_ref: string;
  independent: boolean;
};

type TestBatchArtifact = {
  name: string;
  status: string;
  checkpoint: { status: string; evidence_ref: string };
  adversarial_review: { status: string; evidence_ref: string };
  fix_loop: { status: string; evidence_ref: string; open_findings: number; attempts: number };
};

type TestGovernanceArtifact = Record<string, unknown> & {
  pipeline_requested: boolean;
  pipeline_valid: boolean;
  runtime_mode: string;
  hook_enforcement_mode: string;
  exec_window_enforcement: string;
  status: string;
  missing_capabilities: string[];
  gates: TestGateArtifact[];
  hooks: TestHookArtifact[];
  agents: TestAgentArtifact[];
  batches: TestBatchArtifact[];
  manual_fallback_counts_as_pipeline: false;
  final_verdict: {
    status: string;
    reason: string;
    evidence_ref: string;
  };
};

function runHook(
  cwd: string,
  payload: unknown,
  env: Record<string, string | undefined> = { PIPELINE_SENTINEL_HMAC_KEY: TEST_HMAC_KEY },
) {
  const result = spawnSync(process.execPath, [HOOK], {
    cwd,
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });

  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(",")}}`;
  }

  return JSON.stringify(value);
}

function signSentinel(state: Record<string, unknown>) {
  const signature = createHmac("sha256", TEST_HMAC_KEY).update(canonicalize(state)).digest("hex");
  return {
    ...state,
    _integrity: {
      algorithm: "hmac-sha256",
      signature,
    },
  };
}

function signLedgerEntry(entry: Record<string, unknown>) {
  const unsignedEntry = { ...entry };
  delete unsignedEntry._integrity;
  const signature = createHmac("sha256", TEST_HMAC_KEY).update(canonicalize(unsignedEntry)).digest("hex");
  return {
    ...unsignedEntry,
    _integrity: {
      algorithm: "hmac-sha256",
      scope: "pipeline-ledger-entry",
      signature,
    },
  };
}

function signStateObject(state: Record<string, unknown>, scope: string) {
  const unsignedState = { ...state };
  delete unsignedState._integrity;
  const signature = createHmac("sha256", TEST_HMAC_KEY).update(canonicalize(unsignedState)).digest("hex");
  return {
    ...unsignedState,
    _integrity: {
      algorithm: "hmac-sha256",
      scope,
      signature,
    },
  };
}

function corruptLedgerSignature(entry: Record<string, unknown>) {
  const integrity = entry._integrity && typeof entry._integrity === "object" && !Array.isArray(entry._integrity)
    ? entry._integrity as Record<string, unknown>
    : undefined;
  return {
    ...entry,
    _integrity: {
      ...integrity,
      signature: `${String(integrity?.signature ?? "")}zz`,
    },
  };
}

function writeActiveSentinel(cwd: string, overrides: Record<string, unknown> = {}) {
  const stateDir = join(cwd, ".codex", "pipeline");
  mkdirSync(stateDir, { recursive: true });
  const state = {
    pipelineActive: true,
    currentPhase: "phase-3",
    expectedNext: ["final_verdict"],
    ...overrides,
  };
  writeFileSync(
    join(stateDir, "sentinel-state.json"),
    JSON.stringify(signSentinel(state)),
    "utf8",
  );
  return stateDir;
}

function writeActiveSessionLock(cwd: string, overrides: Record<string, unknown> = {}) {
  const stateDir = join(cwd, ".codex", "pipeline");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    join(stateDir, "session-lock.json"),
    JSON.stringify({
      session_id: "active-session",
      created_at: Math.floor(Date.now() / 1000) - 60,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      status: "active",
      ...overrides,
    }),
    "utf8",
  );
  return stateDir;
}

function writeActiveWorkflowObligations(
  cwd: string,
  options: {
    workflowId?: string;
    requiredActions?: string[];
    completedActions?: string[];
  } = {},
) {
  const stateDir = join(cwd, ".codex", "pipeline");
  mkdirSync(stateDir, { recursive: true });
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  writeFileSync(
    join(stateDir, "workflow-intent.json"),
    JSON.stringify(signStateObject({
      status: "active",
      plugin: "pipeline-orchestrator-for-codex",
      workflow_id: options.workflowId ?? "test-workflow",
      expires_at: expiresAt,
    }, "pipeline-workflow-intent")),
    "utf8",
  );
  writeFileSync(
    join(stateDir, "required-first-actions.json"),
    JSON.stringify(signStateObject({
      status: "active",
      plugin: "pipeline-orchestrator-for-codex",
      workflow_id: options.workflowId ?? "test-workflow",
      required_actions: options.requiredActions ?? [],
      completed_actions: options.completedActions ?? [],
      expires_at: expiresAt,
    }, "pipeline-required-first-actions")),
    "utf8",
  );
  return stateDir;
}

function validArtifact(): TestGovernanceArtifact {
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
    batches: [
      {
        name: "batch-1",
        status: "PASS",
        checkpoint: {
          status: "PASS",
          evidence_ref: "batch:batch-1:checkpoint",
        },
        adversarial_review: {
          status: "PASS",
          evidence_ref: "batch:batch-1:adversarial_review",
        },
        fix_loop: {
          status: "PASS",
          evidence_ref: "batch:batch-1:fix_loop",
          open_findings: 0,
          attempts: 1,
        },
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

function blockedNoAgentRuntimeArtifact(
  missingCapabilities: readonly string[] = ["spawn_agent", "wait_agent"],
) {
  return {
    pipeline_requested: true,
    pipeline_valid: false,
    runtime_mode: "blocked-no-agent-runtime",
    hook_enforcement_mode: "advisory",
    exec_window_enforcement: "cooperative",
    status: "BLOCKED",
    reason: "blocked-no-agent-runtime",
    missing_capabilities: [...missingCapabilities],
    gates: [
      {
        gate: "CAPABILITY_GATE",
        status: "BLOCKED",
        reason: `Missing mandatory pipeline runtime capabilities: ${missingCapabilities.join(", ")}`,
        evidence_ref: "runtime.capabilities",
      },
    ],
    hooks: [],
    agents: [],
    manual_fallback: {
      kind: "manual_fallback_not_pipeline",
      notice: "This is a manual fallback review, not a valid pipeline execution.",
      allowed: true,
      counts_as_pipeline: false,
      recommendation: "Re-run the pipeline when the complete real-agent runtime is available.",
    },
    manual_fallback_allowed: true,
    manual_fallback_counts_as_pipeline: false,
    final_verdict: {
      status: "BLOCKED",
      reason: "blocked-no-agent-runtime",
      evidence_ref: "runtime.capabilities",
    },
  };
}

function artifactIdentityFields(artifact: Record<string, unknown>) {
  return Object.fromEntries(
    ["workflow_id", "workflowId", "run_id", "runId", "session_id", "sessionId", "trace_id", "traceId"]
      .filter((field) => typeof artifact[field] === "string")
      .map((field) => [field, artifact[field]]),
  );
}

function writeLedgerProof(
  cwd: string,
  artifact = validArtifact(),
  options: {
    hookEvents?: boolean;
    waitEvents?: boolean;
    batchEvents?: boolean;
    dispatchMode?: "real" | "emulated";
    activeRun?: string;
    signedLedgerEntries?: boolean;
    corruptLedgerSignature?: boolean;
    protocolTargetName?: (role: string) => string;
  } = {},
) {
  const identityFields = artifactIdentityFields(artifact as Record<string, unknown>);
  const stateDir = writeActiveSentinel(
    cwd,
    options.activeRun ? { workflow_id: options.activeRun } : {},
  );
  writeActiveWorkflowObligations(cwd, { workflowId: options.activeRun });
  const dispatchMode = options.dispatchMode ?? "real";
  const maybeSignLedger = (entry: Record<string, unknown>) => {
    const signed = options.signedLedgerEntries === false ? entry : signLedgerEntry(entry);
    return options.corruptLedgerSignature ? corruptLedgerSignature(signed) : signed;
  };
  writeFileSync(
    join(stateDir, "gate-decisions.jsonl"),
    [
      ...artifact.gates.map((gate) => maybeSignLedger({
        gate: gate.gate,
        decision: "pass",
        status: "PASS",
        ...identityFields,
      })),
      ...(options.batchEvents === false ? [] : artifact.batches.flatMap((batch) => [
        maybeSignLedger({
          gate: `BATCH_LOOP:${batch.name}:checkpoint`,
          decision: "pass",
          status: "PASS",
          evidence_ref: batch.checkpoint.evidence_ref,
          ...identityFields,
        }),
        maybeSignLedger({
          gate: `BATCH_LOOP:${batch.name}:adversarial_review`,
          decision: "pass",
          status: "PASS",
          evidence_ref: batch.adversarial_review.evidence_ref,
          ...identityFields,
        }),
        maybeSignLedger({
          gate: `BATCH_LOOP:${batch.name}:fix_loop`,
          decision: "pass",
          status: "PASS",
          evidence_ref: batch.fix_loop.evidence_ref,
          open_findings: batch.fix_loop.open_findings,
          attempts: batch.fix_loop.attempts,
          ...identityFields,
        }),
      ])),
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    "utf8",
  );
  writeFileSync(
    join(stateDir, "protocol-events.jsonl"),
    artifact.agents.flatMap((agent) => {
      const dispatchId = agent.dispatch_ref.replace(/^dispatch:/u, "");
      const targetName = options.protocolTargetName
        ? options.protocolTargetName(agent.role)
        : agent.role;
      const dispatchEvent = maybeSignLedger({
        event_id: `dispatch-request-${dispatchId}-completed`,
        kind: "DISPATCH_REQUEST",
        status: "completed",
        dispatchMode,
        payload: {
          dispatchId,
          targetName,
          targetKind: "agent",
          ...identityFields,
        },
      });
      const waitEvent = maybeSignLedger({
        event_id: `dispatch-request-${dispatchId}-wait-agent-completed`,
        kind: "DISPATCH_REQUEST",
        status: "completed",
        dispatchMode,
        payload: {
          event: "WAIT_AGENT_COMPLETED",
          capability: "wait_agent",
          dispatchId,
          targetName,
          targetKind: "agent",
          proof: `wait_agent:${agent.role}`,
          ...identityFields,
        },
      });
      return options.waitEvents === false ? [dispatchEvent] : [dispatchEvent, waitEvent];
    }).map((event) => JSON.stringify(event)).join("\n") + "\n",
    "utf8",
  );
  if (options.hookEvents !== false) {
    writeFileSync(
      join(stateDir, "hook-events.jsonl"),
      artifact.hooks.map((hook) => JSON.stringify(maybeSignLedger({
        hook: "workflow-enforcement",
        event: hook.checkpoint,
        decision: "pass",
        status: "PASS",
        expected: `checkpoint:${hook.checkpoint}`,
        reason: `${hook.checkpoint} observed.`,
        ...identityFields,
      }))).join("\n") + "\n",
      "utf8",
    );
  }
  const checkpointsDir = join(stateDir, "checkpoints");
  mkdirSync(checkpointsDir, { recursive: true });
  artifact.hooks.forEach((hook, index) => {
    writeFileSync(
      join(checkpointsDir, `hook-${index}.json`),
      JSON.stringify(maybeSignLedger({
        name: hook.checkpoint,
        status: "completed",
        phase: "phase-3",
        batchIndex: 0,
        timestamp: new Date().toISOString(),
        ...identityFields,
      })),
      "utf8",
    );
  });
  return stateDir;
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

  it("TDD: blocks quiet stop after explicit pipeline front door even when state files were erased", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-frontdoor-state-erased-"));

    const output = runHook(cwd, {
      cwd,
      input: "/pipeline-orchestrator-for-codex:pipeline faca o bugfix heavy",
      output: {
        text: "Resumo parcial sem artefato final.",
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("PipelineGovernanceArtifact");
  });

  it("TDD: blocks quiet stop after explicit workflow intent without a governance artifact", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-workflow-intent-no-artifact-"));
    const stateDir = join(cwd, ".codex", "pipeline");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "workflow-intent.json"),
      JSON.stringify(signStateObject({
        schema_version: 1,
        status: "active",
        plugin: "pipeline-orchestrator-for-codex",
        workflow: "bugfix-heavy",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        deterministic_enforcement: {
          stop_requires_governance_artifact: true,
        },
      }, "pipeline-workflow-intent")),
      "utf8",
    );

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "Summary: done.",
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("PipelineGovernanceArtifact");
  });

  it("TDD: blocks quiet stop after required-first-actions without a governance artifact", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-required-first-no-artifact-"));
    const stateDir = join(cwd, ".codex", "pipeline");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "required-first-actions.json"),
      JSON.stringify(signStateObject({
        schema_version: 1,
        status: "active",
        plugin: "pipeline-orchestrator-for-codex",
        workflow: "bugfix-heavy",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        required_actions: ["update_plan", "WORKFLOW_METHOD_GATE"],
        completed_actions: [],
      }, "pipeline-required-first-actions")),
      "utf8",
    );

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "Summary: done.",
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("PipelineGovernanceArtifact");
    expect(output.systemMessage).toContain("Do not stop");
    expect(output.systemMessage).toContain("canonical sequence");
    expect(output.systemMessage).toContain("pipeline-orchestrator-for-codex:core:pipeline-controller");
  });

  it("TDD: blocks quiet stop when malformed workflow intent is the only pipeline signal", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-malformed-intent-only-"));
    const stateDir = join(cwd, ".codex", "pipeline");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "workflow-intent.json"), "{", "utf8");

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "Summary: done.",
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("workflow_intent_integrity:hmac-sha256");
  });

  it("TDD: blocks quiet stop when invalid required-first-actions is the only pipeline signal", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-invalid-required-only-"));
    const stateDir = join(cwd, ".codex", "pipeline");
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(join(stateDir, "required-first-actions.json"));

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "Summary: done.",
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("required_first_actions_integrity:hmac-sha256");
  });

  it("TDD: blocks PASS artifacts without per-batch checkpoint adversarial review and closed fix loop", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-missing-batch-loop-"));
    const artifact = {
      ...validArtifact(),
      run_id: "current-run",
      session_id: "current-session",
      batches: [],
    };
    writeLedgerProof(cwd, artifact, { batchEvents: false });
    writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE",
        pipelineGovernanceArtifact: artifact,
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("batch_loop:batches");
  });

  it.each([
    "[@pipeline-orchestrator-for-codex](plugin://pipeline-orchestrator-for-codex@fx-studio-ai) audite o workflow atual",
    "/pipeline-orchestrator:pipeline audite o workflow atual",
  ])("TDD: blocks terminal closeout through explicit pipeline front door %s without an artifact", (prompt) => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-front-door-no-artifact-"));

    const output = runHook(cwd, {
      cwd,
      prompt,
      output: {
        text: "FINAL_ADVERSARIAL_REPORT: CLEAN",
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("PipelineGovernanceArtifact");
  });

  it("TDD: blocks adversarial review clean closeout through explicit front door without active state", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-adversarial-clean-no-state-"));

    const output = runHook(cwd, {
      cwd,
      prompt: "/pipeline-orchestrator:pipeline revise meu workflow atual",
      output: {
        text: "ADVERSARIAL_REVIEW: CLEAN",
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("PipelineGovernanceArtifact");
  });

  it("RED: blocks PIPELINE_STATUS PASS closeout through explicit front door without an artifact", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-pipeline-status-pass-no-artifact-"));

    const output = runHook(cwd, {
      cwd,
      prompt: "/pipeline-orchestrator-for-codex:pipeline revise meu workflow atual",
      output: {
        text: "SUMMARY\nPIPELINE_STATUS: PASS\nNo P0/P1/P2 findings remain.",
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("PipelineGovernanceArtifact");
  });

  it("RED: blocks active sentinel blocked-no-agent-runtime output without an artifact", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-blocked-no-artifact-"));
    writeActiveSentinel(cwd);

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "blocked-no-agent-runtime: spawn_agent unavailable",
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("PipelineGovernanceArtifact");
  });

  it.each([
    "FINAL_REVIEW: GO",
    "Final verdict: GO",
    "FINAL DECISION: GO",
    "FINAL_ADVERSARIAL_REPORT: CLEAN",
    "Final decision: CONDITIONAL",
    "final_verdict: PASS",
    "Final verdict = GO",
    "FINAL_REVIEW = GO",
    "GO/NO-GO: GO",
    "Verdict: PASS",
    "VERDICT: APPROVED",
    "Review Verdict: APPROVED",
    "FINAL VERDICT - PASS",
    "final_verdict = PASS",
    "FINAL_ADVERSARIAL_REPORT = CLEAN",
    "Final decision - CONDITIONAL",
    "Final verdict is GO",
    "Final decision is CONDITIONAL",
    "Final adversarial report is CLEAN",
  ])("TDD: blocks active pipeline terminal status %s without a governance artifact", (text) => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-terminal-no-artifact-"));
    writeActiveSentinel(cwd);

    const output = runHook(cwd, {
      cwd,
      output: { text },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("PipelineGovernanceArtifact");
  });

  it.each([
    "Final review GO",
    "Final verdict GO",
    "Final decision GO",
    "FINAL_ADVERSARIAL_REVIEW: CLEAN",
    "Final adversarial review: CLEAN",
    "Final report: CLEAN",
    "FINAL REPORT: PASS",
    "No P0/P1/P2 remain",
  ])("TDD: blocks separatorless terminal closeout %s for an inactive phase-3 session", (text) => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-inactive-terminal-no-artifact-"));
    const stateDir = writeActiveSentinel(cwd, {
      pipelineActive: false,
      run_id: "current-run",
      session_id: "current-session",
    });
    writeFileSync(
      join(stateDir, "session.json"),
      JSON.stringify({
        run_id: "current-run",
        session_id: "current-session",
        currentPhase: "phase-3",
      }),
      "utf8",
    );

    const output = runHook(cwd, {
      cwd,
      output: { text },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("PipelineGovernanceArtifact");
  });

  it("TDD: blocks inactive phase-3 JSON closeout claiming pipeline_valid true without artifact", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-inactive-json-pass-no-artifact-"));
    const stateDir = writeActiveSentinel(cwd, {
      pipelineActive: false,
      run_id: "current-run",
      session_id: "current-session",
    });
    writeFileSync(
      join(stateDir, "session.json"),
      JSON.stringify({
        run_id: "current-run",
        session_id: "current-session",
        currentPhase: "phase-3",
      }),
      "utf8",
    );

    const output = runHook(cwd, {
      cwd,
      output: {
        text: JSON.stringify({
          pipeline_valid: true,
          final_verdict: { status: "PASS" },
        }),
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("PipelineGovernanceArtifact");
  });

  it.each([
    "FINAL_REVIEW: GO",
    "## Review Verdict\n- VERDICT: APPROVED",
    "Final decision: CONDITIONAL",
    "Final decision is CONDITIONAL",
    "FINAL DECISION - CONDITIONAL",
  ])("TDD: blocks success-looking terminal output backed only by a stale BLOCKED artifact file: %s", (text) => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-stale-blocked-artifact-"));
    const stateDir = writeActiveSentinel(cwd);
    writeFileSync(
      join(stateDir, "pipeline-governance-artifact.json"),
      JSON.stringify(blockedNoAgentRuntimeArtifact()),
      "utf8",
    );

    const output = runHook(cwd, {
      cwd,
      output: {
        text,
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("missing governance evidence");
    expect(output.stopReason).toContain("pipeline_valid");
  });

  it("TDD: blocks a stale file-sourced BLOCKED artifact from a previous run", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-stale-blocked-file-"));
    const stateDir = writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });
    writeFileSync(
      join(stateDir, "pipeline-governance-artifact.json"),
      JSON.stringify({
        ...blockedNoAgentRuntimeArtifact(),
        run_id: "old-run",
        session_id: "old-session",
      }),
      "utf8",
    );

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE blocked-no-agent-runtime",
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("current_run_identity");
  });

  it("TDD: blocks replayed file-sourced BLOCKED even when stale active state still matches it", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-replayed-blocked-file-"));
    const stateDir = writeActiveSentinel(cwd, {
      run_id: "old-run",
      session_id: "old-session",
    });
    writeFileSync(
      join(stateDir, "pipeline-governance-artifact.json"),
      JSON.stringify({
        ...blockedNoAgentRuntimeArtifact(),
        run_id: "old-run",
        session_id: "old-session",
      }),
      "utf8",
    );

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE blocked-no-agent-runtime",
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("current_run_identity");
  });

  it("TDD: blocks a stale file-sourced PASS artifact when only session_id matches current state", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-partial-identity-pass-"));
    const artifact = {
      ...validArtifact(),
      run_id: "old-run",
      session_id: "current-session",
    };
    const stateDir = writeLedgerProof(cwd, artifact);
    writeFileSync(
      join(stateDir, "pipeline-governance-artifact.json"),
      JSON.stringify(artifact),
      "utf8",
    );
    writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "FINAL_REVIEW: GO",
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("current_run_identity");
  });

  it("TDD: blocks a stale payload-sourced BLOCKED artifact when only session_id matches current state", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-partial-identity-blocked-"));
    writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE blocked-no-agent-runtime",
        pipelineGovernanceArtifact: {
          ...blockedNoAgentRuntimeArtifact(),
          run_id: "old-run",
          session_id: "current-session",
        },
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("current_run_identity");
  });

  it("TDD: blocks a stale payload-sourced BLOCKED artifact from a previous run", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-stale-blocked-payload-"));
    writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE blocked-no-agent-runtime",
        pipelineGovernanceArtifact: {
          ...blockedNoAgentRuntimeArtifact(),
          run_id: "old-run",
          session_id: "old-session",
        },
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("current_run_identity");
  });

  it("TDD: blocks a stale session-sourced BLOCKED artifact from a previous run", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-stale-blocked-session-"));
    const stateDir = writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });
    writeFileSync(
      join(stateDir, "session.json"),
      JSON.stringify({
        governanceArtifact: {
          ...blockedNoAgentRuntimeArtifact(),
          run_id: "old-run",
          session_id: "old-session",
        },
      }),
      "utf8",
    );

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE blocked-no-agent-runtime",
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("current_run_identity");
  });

  it("TDD: blocks replayed session-sourced BLOCKED even when stale active state still matches it", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-replayed-blocked-session-"));
    const stateDir = writeActiveSentinel(cwd, {
      run_id: "old-run",
      session_id: "old-session",
    });
    writeFileSync(
      join(stateDir, "session.json"),
      JSON.stringify({
        pipelineActive: true,
        currentPhase: "phase-3",
        run_id: "old-run",
        session_id: "old-session",
        governanceArtifact: {
          ...blockedNoAgentRuntimeArtifact(),
          run_id: "old-run",
          session_id: "old-session",
        },
      }),
      "utf8",
    );

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE blocked-no-agent-runtime",
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("current_run_identity");
  });

  it("TDD: blocks a stale file-sourced PASS artifact from a previous run", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-stale-pass-artifact-"));
    const artifact = {
      ...validArtifact(),
      workflow_id: "old-run",
    };
    const stateDir = writeLedgerProof(cwd, artifact, { activeRun: "old-run" });
    writeFileSync(
      join(stateDir, "pipeline-governance-artifact.json"),
      JSON.stringify(artifact),
      "utf8",
    );
    writeActiveSentinel(cwd, { workflow_id: "new-run" });

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "FINAL_REVIEW: GO",
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("current_run_identity");
  });

  it("TDD: blocks a stale payload-sourced PASS artifact from a previous run", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-stale-payload-pass-artifact-"));
    const artifact = {
      ...validArtifact(),
      workflow_id: "full",
      run_id: "old-run",
      session_id: "old-session",
    };
    writeLedgerProof(cwd, artifact, { activeRun: "full" });
    writeActiveSentinel(cwd, {
      workflow_id: "full",
      run_id: "new-run",
      session_id: "new-session",
    });

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE",
        pipelineGovernanceArtifact: artifact,
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("current_run_identity");
  });

  it("TDD: prioritizes sentinel identity over stale session identity for file-sourced PASS artifacts", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-stale-session-pass-artifact-"));
    const artifact = {
      ...validArtifact(),
      workflow_id: "old-run",
    };
    const stateDir = writeLedgerProof(cwd, artifact, { activeRun: "old-run" });
    writeFileSync(
      join(stateDir, "pipeline-governance-artifact.json"),
      JSON.stringify(artifact),
      "utf8",
    );
    writeFileSync(
      join(stateDir, "session.json"),
      JSON.stringify({
        pipelineActive: true,
        workflow_id: "old-run",
      }),
      "utf8",
    );
    writeActiveSentinel(cwd, { workflow_id: "new-run" });

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "FINAL_REVIEW: GO",
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("current_run_identity");
  });

  it("TDD: blocks a stale signed sentinel when session has a newer strong identity", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-stale-sentinel-current-session-"));
    const artifact = {
      ...validArtifact(),
      run_id: "old-run",
      session_id: "old-session",
    };
    const stateDir = writeLedgerProof(cwd, artifact);
    writeFileSync(
      join(stateDir, "pipeline-governance-artifact.json"),
      JSON.stringify(artifact),
      "utf8",
    );
    writeActiveSentinel(cwd, {
      pipelineActive: false,
      run_id: "old-run",
      session_id: "old-session",
    });
    writeFileSync(
      join(stateDir, "session.json"),
      JSON.stringify({
        pipelineActive: true,
        currentPhase: "phase-3",
        run_id: "current-run",
        session_id: "current-session",
      }),
      "utf8",
    );

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "FINAL_REVIEW: GO",
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("current_run_identity");
  });

  it("TDD: blocks no-overlap strong sentinel/session identities from forming a composite PASS run", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-no-overlap-composite-"));
    const artifact = {
      ...validArtifact(),
      run_id: "current-run",
      session_id: "old-session",
    };
    const stateDir = writeLedgerProof(cwd, artifact);
    writeFileSync(
      join(stateDir, "pipeline-governance-artifact.json"),
      JSON.stringify(artifact),
      "utf8",
    );
    writeActiveSentinel(cwd, {
      pipelineActive: true,
      run_id: "current-run",
    });
    writeFileSync(
      join(stateDir, "session.json"),
      JSON.stringify({
        pipelineActive: true,
        currentPhase: "phase-3",
        session_id: "old-session",
      }),
      "utf8",
    );

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "FINAL_REVIEW: GO",
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("current_run_identity");
  });

  it("TDD: blocks nested session identity from splicing a current signed run into a stale session", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-nested-session-splice-"));
    const artifact = {
      ...validArtifact(),
      run_id: "current-run",
      session_id: "old-session",
    };
    const stateDir = writeLedgerProof(cwd, artifact);
    writeFileSync(
      join(stateDir, "pipeline-governance-artifact.json"),
      JSON.stringify(artifact),
      "utf8",
    );
    writeActiveSentinel(cwd, {
      pipelineActive: true,
      run_id: "current-run",
    });
    writeFileSync(
      join(stateDir, "session.json"),
      JSON.stringify({
        pipelineActive: true,
        currentPhase: "phase-3",
        session_id: "old-session",
        governanceArtifact: {
          run_id: "current-run",
        },
      }),
      "utf8",
    );

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "FINAL_REVIEW: GO",
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("current_run_identity");
  });

  it("TDD: uses strong session identity before weak sentinel workflow_id for file-sourced PASS artifacts", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-weak-sentinel-stale-pass-artifact-"));
    const artifact = {
      ...validArtifact(),
      workflow_id: "full",
      run_id: "old-run",
      session_id: "old-session",
    };
    const stateDir = writeLedgerProof(cwd, artifact, { activeRun: "full" });
    writeFileSync(
      join(stateDir, "pipeline-governance-artifact.json"),
      JSON.stringify(artifact),
      "utf8",
    );
    writeActiveSentinel(cwd, {
      workflow_id: "full",
    });
    writeFileSync(
      join(stateDir, "session.json"),
      JSON.stringify({
        pipelineActive: true,
        workflow_id: "full",
        run_id: "new-run",
        session_id: "new-session",
      }),
      "utf8",
    );

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "FINAL_REVIEW: GO",
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("current_run_identity");
  });

  it("TDD: blocks stale file-sourced PASS when old and new runs share generic workflow mode", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-stale-mode-pass-artifact-"));
    const artifact = {
      ...validArtifact(),
      workflow_id: "full",
      run_id: "old-run",
      session_id: "old-session",
    };
    const stateDir = writeLedgerProof(cwd, artifact, { activeRun: "full" });
    writeFileSync(
      join(stateDir, "pipeline-governance-artifact.json"),
      JSON.stringify(artifact),
      "utf8",
    );
    writeActiveSentinel(cwd, {
      workflow_id: "full",
      run_id: "new-run",
      session_id: "new-session",
    });

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "FINAL_REVIEW: GO",
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("current_run_identity");
  });

  it("TDD: allows file-sourced PASS only when artifact, ledgers, and active sentinel share the run identity", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-current-pass-artifact-"));
    const artifact = {
      ...validArtifact(),
      workflow_id: "current-run",
      run_id: "current-run",
    };
    const stateDir = writeLedgerProof(cwd, artifact, { activeRun: "current-run" });
    writeActiveSentinel(cwd, {
      workflow_id: "current-run",
      run_id: "current-run",
    });
    writeFileSync(
      join(stateDir, "pipeline-governance-artifact.json"),
      JSON.stringify(artifact),
      "utf8",
    );

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "FINAL_REVIEW: GO",
      },
    });

    expect(output.continue).toBe(true);
    expect(output.additionalContext).toContain("Artefato final estruturado");
  });

  it("TDD: blocks PASS when only a generic workflow_id links the artifact to active state", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-weak-workflow-pass-"));
    const artifact = {
      ...validArtifact(),
      workflow_id: "full",
    };
    const stateDir = writeLedgerProof(cwd, artifact, { activeRun: "full" });
    writeFileSync(
      join(stateDir, "pipeline-governance-artifact.json"),
      JSON.stringify(artifact),
      "utf8",
    );

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "FINAL_REVIEW: GO",
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("current_run_identity");
  });

  it("TDD: blocks file-sourced BLOCKED when only a generic workflow_id links it to active state", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-weak-workflow-file-blocked-"));
    const artifact = {
      ...blockedNoAgentRuntimeArtifact(),
      workflow_id: "full",
    };
    const stateDir = writeActiveSentinel(cwd, { workflow_id: "full" });
    writeFileSync(
      join(stateDir, "pipeline-governance-artifact.json"),
      JSON.stringify(artifact),
      "utf8",
    );

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE blocked-no-agent-runtime",
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("current_run_identity");
  });

  it("TDD: blocks payload-sourced BLOCKED when only a generic workflow_id links it to active state", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-weak-workflow-payload-blocked-"));
    writeActiveSentinel(cwd, { workflow_id: "full" });

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE blocked-no-agent-runtime",
        pipelineGovernanceArtifact: {
          ...blockedNoAgentRuntimeArtifact(),
          workflow_id: "full",
        },
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("current_run_identity");
  });

  it("TDD: blocks session-sourced BLOCKED when only a generic workflow_id links it to active state", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-weak-workflow-session-blocked-"));
    const stateDir = writeActiveSentinel(cwd, { workflow_id: "full" });
    writeFileSync(
      join(stateDir, "session.json"),
      JSON.stringify({
        pipelineActive: true,
        currentPhase: "phase-3",
        workflow_id: "full",
        governanceArtifact: {
          ...blockedNoAgentRuntimeArtifact(),
          workflow_id: "full",
        },
      }),
      "utf8",
    );

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE blocked-no-agent-runtime",
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("current_run_identity");
  });

  it.each([
    "Done. No blocking issues remain.",
    "Resumo final: sem P0/P1/P2.",
  ])("TDD: blocks active pipeline closeout text %s without a governance artifact", (text) => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-active-closeout-no-artifact-"));
    writeActiveSentinel(cwd);

    const output = runHook(cwd, {
      cwd,
      output: { text },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("PipelineGovernanceArtifact");
  });

  it("ATDD: allows explicit pipeline stop with a structured blocked-no-agent-runtime artifact", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-blocked-artifact-"));
    writeActiveSentinel(cwd);
    writeActiveWorkflowObligations(cwd);

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE blocked-no-agent-runtime",
        pipelineGovernanceArtifact: blockedNoAgentRuntimeArtifact(),
      },
    });

    expect(output.continue).toBe(true);
    expect(output.additionalContext).toContain("Artefato final estruturado");
  });

  it("TDD: allows current payload BLOCKED when transcript has an older success verdict", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-blocked-dirty-transcript-"));
    writeActiveSentinel(cwd);
    writeActiveWorkflowObligations(cwd);
    const transcriptPath = join(cwd, "transcript.txt");
    writeFileSync(transcriptPath, "Earlier assistant text: FINAL_REVIEW: GO", "utf8");

    const output = runHook(cwd, {
      cwd,
      transcript_path: transcriptPath,
      output: {
        text: "PIPELINE COMPLETE blocked-no-agent-runtime",
        pipelineGovernanceArtifact: blockedNoAgentRuntimeArtifact(),
      },
    });

    expect(output.continue).toBe(true);
    expect(output.additionalContext).toContain("Artefato final estruturado");
  });

  it("ATDD: allows explicit pipeline stop with a structured BLOCKED artifact for the current run", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-current-blocked-artifact-"));
    writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });
    writeActiveWorkflowObligations(cwd);

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE blocked-no-agent-runtime",
        pipelineGovernanceArtifact: {
          ...blockedNoAgentRuntimeArtifact(),
          run_id: "current-run",
          session_id: "current-session",
        },
      },
    });

    expect(output.continue).toBe(true);
    expect(output.additionalContext).toContain("Artefato final estruturado");
  });

  it("TDD: blocks structured BLOCKED artifacts when active obligation files are missing", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-blocked-missing-obligations-"));
    writeActiveSentinel(cwd);

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE blocked-no-agent-runtime",
        pipelineGovernanceArtifact: blockedNoAgentRuntimeArtifact(),
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("workflow_intent:present");
    expect(output.stopReason).toContain("required_first_actions:present");
  });

  it("TDD: blocks structured BLOCKED artifacts when only session-lock survived", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-blocked-session-lock-only-"));
    writeActiveSessionLock(cwd);

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE blocked-no-agent-runtime",
        pipelineGovernanceArtifact: blockedNoAgentRuntimeArtifact(["spawn_agent"]),
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("workflow_intent:present");
    expect(output.stopReason).toContain("required_first_actions:present");
  });

  it("TDD: blocks structured BLOCKED artifacts when required-first-actions remain incomplete", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-blocked-required-actions-"));
    writeActiveSentinel(cwd);
    writeActiveWorkflowObligations(cwd, {
      requiredActions: ["update_plan", "WORKFLOW_METHOD_GATE"],
      completedActions: ["update_plan"],
    });

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE blocked-no-agent-runtime",
        pipelineGovernanceArtifact: blockedNoAgentRuntimeArtifact(),
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("required_action:WORKFLOW_METHOD_GATE");
  });

  it("RED: accepts structured BLOCKED artifact with every required pipeline capability missing", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-blocked-all-capabilities-"));
    writeActiveSentinel(cwd);
    writeActiveWorkflowObligations(cwd);

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE blocked-no-agent-runtime",
        pipelineGovernanceArtifact: blockedNoAgentRuntimeArtifact(REQUIRED_PIPELINE_CAPABILITIES),
      },
    });

    expect(output.continue).toBe(true);
    expect(output.additionalContext).toContain("Artefato final estruturado");
  });

  it("TDD: blocks blocked-no-agent-runtime that claims spawn/wait missing after bootstrap proved them", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-blocked-bootstrap-contradiction-"));
    writeActiveSentinel(cwd);
    writeActiveWorkflowObligations(cwd, {
      requiredActions: [
        "update_plan",
        "WORKFLOW_METHOD_GATE",
        "CAPABILITY_GATE",
        "spawn:pipeline-orchestrator-for-codex:core:pipeline-controller",
        "wait_agent",
      ],
      completedActions: [
        "update_plan",
        "WORKFLOW_METHOD_GATE",
        "CAPABILITY_GATE",
        "spawn:pipeline-orchestrator-for-codex:core:pipeline-controller",
        "wait_agent",
      ],
    });

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE blocked-no-agent-runtime",
        pipelineGovernanceArtifact: blockedNoAgentRuntimeArtifact(REQUIRED_PIPELINE_CAPABILITIES),
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("missing_capability_contradicts_bootstrap:spawn_agent");
    expect(output.stopReason).toContain("missing_capability_contradicts_bootstrap:wait_agent");
  });

  it("RED: accepts structured BLOCKED artifact when real-agent runtime lacks artifact collection", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-blocked-artifact-collection-"));
    writeActiveSentinel(cwd);
    writeActiveWorkflowObligations(cwd);

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE blocked-no-agent-runtime",
        pipelineGovernanceArtifact: {
          ...blockedNoAgentRuntimeArtifact(["subagent_artifact_collection"]),
          runtime_mode: "real-agent",
        },
      },
    });

    expect(output.continue).toBe(true);
    expect(output.additionalContext).toContain("Artefato final estruturado");
  });

  it("TDD: blocks contradictory real-agent BLOCKED artifacts that claim foundational runtime capabilities are missing", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-real-agent-contradiction-"));
    writeActiveSentinel(cwd);

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE blocked-no-agent-runtime",
        pipelineGovernanceArtifact: {
          ...blockedNoAgentRuntimeArtifact(["spawn_agent"]),
          runtime_mode: "real-agent",
        },
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("missing governance evidence");
    expect(output.stopReason).toContain("pipeline_valid");
  });

  it("TDD: blocks real-agent BLOCKED artifacts that claim the structured final state is missing", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-real-agent-structured-state-contradiction-"));
    writeActiveSentinel(cwd);

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE blocked-no-agent-runtime",
        pipelineGovernanceArtifact: {
          ...blockedNoAgentRuntimeArtifact(["structured_final_state"]),
          runtime_mode: "real-agent",
        },
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("missing governance evidence");
    expect(output.stopReason).toContain("pipeline_valid");
  });

  it("TDD: blocks blocked-no-agent-runtime artifacts that do not declare a missing agent runtime", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-blocked-runtime-contradiction-"));
    writeActiveSentinel(cwd);

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE blocked-no-agent-runtime",
        pipelineGovernanceArtifact: blockedNoAgentRuntimeArtifact(["structured_final_state"]),
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("missing governance evidence");
    expect(output.stopReason).toContain("pipeline_valid");
  });

  it("TDD: blocks forged BLOCKED artifacts with bogus missing capabilities", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-forged-blocked-"));
    writeActiveSentinel(cwd);
    const artifact = blockedNoAgentRuntimeArtifact();

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE",
        pipelineGovernanceArtifact: {
          ...artifact,
          missing_capabilities: ["definitely_not_spawn_agent"],
        },
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("missing governance evidence");
    expect(output.stopReason).toContain("pipeline_valid");
  });

  it("TDD: validates forged BLOCKED artifacts even without textual completion claims", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-forged-blocked-no-complete-"));
    writeActiveSentinel(cwd);
    const artifact = blockedNoAgentRuntimeArtifact();

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "status BLOCKED blocked-no-agent-runtime",
        pipelineGovernanceArtifact: {
          ...artifact,
          missing_capabilities: ["definitely_not_spawn_agent"],
        },
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("missing governance evidence");
    expect(output.stopReason).toContain("pipeline_valid");
  });

  it("TDD: blocks BLOCKED artifacts contaminated with extra bogus capabilities", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-forged-blocked-extra-capability-"));
    writeActiveSentinel(cwd);
    const artifact = blockedNoAgentRuntimeArtifact();

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "status BLOCKED blocked-no-agent-runtime",
        pipelineGovernanceArtifact: {
          ...artifact,
          missing_capabilities: ["spawn_agent", "wait_agent", "definitely_not_spawn_agent"],
        },
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("missing governance evidence");
    expect(output.stopReason).toContain("pipeline_valid");
  });

  it("blocks a forged pipeline_valid=true artifact with missing ledgers", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-forged-"));
    writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE",
        pipelineGovernanceArtifact: {
          run_id: "current-run",
          session_id: "current-session",
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
    writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE",
        pipelineGovernanceArtifact: {
          ...validArtifact(),
          run_id: "current-run",
          session_id: "current-session",
        },
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("ledger:gate:CAPABILITY_GATE");
    expect(output.stopReason).toContain("ledger:wait_agent:primary_reviewer");
  });

  it("blocks a complete-looking artifact when checkpoint files exist without hook-events", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-missing-hook-events-"));
    const artifact = {
      ...validArtifact(),
      run_id: "current-run",
      session_id: "current-session",
    };
    writeLedgerProof(cwd, artifact, { hookEvents: false });
    writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });

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
    const artifact = {
      ...validArtifact(),
      run_id: "current-run",
      session_id: "current-session",
    };
    writeLedgerProof(cwd, artifact, { waitEvents: false });
    writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });

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

  it("TDD: blocks a complete-looking artifact when batch-loop ledgers are missing", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-missing-batch-ledgers-"));
    const artifact = {
      ...validArtifact(),
      run_id: "current-run",
      session_id: "current-session",
    };
    writeLedgerProof(cwd, artifact, { batchEvents: false });
    writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE",
        pipelineGovernanceArtifact: artifact,
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("ledger:batch:batch-1:checkpoint");
    expect(output.stopReason).toContain("ledger:batch:batch-1:adversarial_review");
    expect(output.stopReason).toContain("ledger:batch:batch-1:fix_loop");
  });

  it("TDD: rejects generic signed ledger strings as batch-loop evidence", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-generic-batch-evidence-"));
    const artifact = {
      ...validArtifact(),
      run_id: "current-run",
      session_id: "current-session",
      batches: [
        {
          name: "batch-1",
          status: "PASS",
          checkpoint: { status: "PASS", evidence_ref: "PASS" },
          adversarial_review: { status: "PASS", evidence_ref: "PASS" },
          fix_loop: { status: "PASS", evidence_ref: "PASS", open_findings: 0, attempts: 1 },
        },
      ],
    };
    writeLedgerProof(cwd, artifact);
    writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE",
        pipelineGovernanceArtifact: artifact,
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("batch:batch-1:checkpoint:evidence_ref");
    expect(output.stopReason).toContain("batch:batch-1:adversarial_review:evidence_ref");
    expect(output.stopReason).toContain("batch:batch-1:fix_loop:evidence_ref");
  });

  it("TDD: rejects signed failing batch-loop ledgers", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-failing-batch-ledgers-"));
    const artifact = {
      ...validArtifact(),
      run_id: "current-run",
      session_id: "current-session",
    };
    const stateDir = writeLedgerProof(cwd, artifact, { batchEvents: false });
    writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });
    const identityFields = artifactIdentityFields(artifact as Record<string, unknown>);
    for (const batch of artifact.batches) {
      appendFileSync(
        join(stateDir, "gate-decisions.jsonl"),
        [
          signLedgerEntry({
            gate: `BATCH_LOOP:${batch.name}:checkpoint`,
            decision: "fail",
            status: "FAIL",
            evidence_ref: batch.checkpoint.evidence_ref,
            ...identityFields,
          }),
          signLedgerEntry({
            gate: `BATCH_LOOP:${batch.name}:adversarial_review`,
            decision: "fail",
            status: "FAIL",
            evidence_ref: batch.adversarial_review.evidence_ref,
            ...identityFields,
          }),
          signLedgerEntry({
            gate: `BATCH_LOOP:${batch.name}:fix_loop`,
            decision: "fail",
            status: "FAIL",
            evidence_ref: batch.fix_loop.evidence_ref,
            open_findings: 2,
            attempts: 9,
            ...identityFields,
          }),
        ].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
        "utf8",
      );
    }

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE",
        pipelineGovernanceArtifact: artifact,
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("ledger:batch:batch-1:checkpoint");
    expect(output.stopReason).toContain("ledger:batch:batch-1:adversarial_review");
    expect(output.stopReason).toContain("ledger:batch:batch-1:fix_loop");
  });

  it("allows explicit pipeline completion with a complete governance artifact and matching ledgers", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-valid-ledger-"));
    const artifact = {
      ...validArtifact(),
      run_id: "current-run",
      session_id: "current-session",
    };
    writeLedgerProof(cwd, artifact);
    writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });

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

  it("TDD: blocks PASS artifacts without cooperative exec window enforcement", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-exec-window-"));
    const artifact = {
      ...validArtifact(),
      run_id: "current-run",
      session_id: "current-session",
      exec_window_enforcement: "advisory",
    };
    writeLedgerProof(cwd, artifact);
    writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE",
        pipelineGovernanceArtifact: artifact,
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("exec_window_enforcement:cooperative");
  });

  it("TDD: blocks final PASS when required-first-actions remain incomplete", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-required-actions-incomplete-"));
    const artifact = {
      ...validArtifact(),
      run_id: "current-run",
      session_id: "current-session",
    };
    const stateDir = writeLedgerProof(cwd, artifact);
    writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });
    writeFileSync(
      join(stateDir, "required-first-actions.json"),
      JSON.stringify(signStateObject({
        schema_version: 1,
        status: "active",
        plugin: "pipeline-orchestrator-for-codex",
        workflow: "bugfix-heavy",
        run_id: "current-run",
        session_id: "current-session",
        required_actions: ["update_plan", "WORKFLOW_METHOD_GATE"],
        completed_actions: ["update_plan"],
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      }, "pipeline-required-first-actions")),
      "utf8",
    );

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE",
        pipelineGovernanceArtifact: artifact,
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("required_action:WORKFLOW_METHOD_GATE");
  });

  it("TDD: blocks final PASS when required-first-actions rely on stale same-session ledgers", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-required-actions-stale-ledger-"));
    const artifact = {
      ...validArtifact(),
      run_id: "current-run",
      session_id: "current-session",
    };
    const stateDir = writeLedgerProof(cwd, artifact);
    writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });
    appendFileSync(
      join(stateDir, "gate-decisions.jsonl"),
      JSON.stringify(signLedgerEntry({
        gate: "CAPABILITY_GATE",
        decision: "approved",
        status: "PASS",
        run_id: "current-run",
        session_id: "current-session",
        timestamp: new Date(Date.now() - 60_000).toISOString(),
      })) + "\n",
      "utf8",
    );
    writeFileSync(
      join(stateDir, "required-first-actions.json"),
      JSON.stringify(signStateObject({
        schema_version: 1,
        status: "active",
        plugin: "pipeline-orchestrator-for-codex",
        workflow: "bugfix-heavy",
        run_id: "current-run",
        session_id: "current-session",
        created_at: new Date(Date.now() + 60_000).toISOString(),
        required_actions: ["CAPABILITY_GATE"],
        completed_actions: [],
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      }, "pipeline-required-first-actions")),
      "utf8",
    );

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE",
        pipelineGovernanceArtifact: artifact,
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("required_action:CAPABILITY_GATE");
  });

  it("TDD: blocks final PASS when active pipeline obligation files are deleted", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-obligation-files-missing-"));
    const artifact = {
      ...validArtifact(),
      run_id: "active-run",
      session_id: "active-session",
    };
    const stateDir = writeLedgerProof(cwd, artifact);
    writeActiveSentinel(cwd, {
      run_id: "active-run",
      session_id: "active-session",
    });
    writeFileSync(
      join(stateDir, "pipeline-governance-artifact.json"),
      JSON.stringify(artifact),
      "utf8",
    );
    unlinkSync(join(stateDir, "workflow-intent.json"));
    unlinkSync(join(stateDir, "required-first-actions.json"));

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "FINAL_REVIEW: GO",
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("workflow_intent:present");
    expect(output.stopReason).toContain("required_first_actions:present");
  });

  it("TDD: blocks final PASS when active pipeline obligation files are malformed", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-obligation-files-malformed-"));
    const artifact = {
      ...validArtifact(),
      run_id: "active-run",
      session_id: "active-session",
    };
    const stateDir = writeLedgerProof(cwd, artifact);
    writeActiveSentinel(cwd, {
      run_id: "active-run",
      session_id: "active-session",
    });
    writeFileSync(
      join(stateDir, "pipeline-governance-artifact.json"),
      JSON.stringify(artifact),
      "utf8",
    );
    writeFileSync(join(stateDir, "workflow-intent.json"), "{", "utf8");
    writeFileSync(join(stateDir, "required-first-actions.json"), "", "utf8");

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "FINAL_REVIEW: GO",
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("workflow_intent_integrity:hmac-sha256");
    expect(output.stopReason).toContain("required_first_actions_integrity:hmac-sha256");
  });

  it("TDD: blocks final PASS when active pipeline obligation files are symlinks", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-obligation-files-symlink-"));
    const artifact = {
      ...validArtifact(),
      run_id: "active-run",
      session_id: "active-session",
    };
    const stateDir = writeLedgerProof(cwd, artifact);
    writeActiveSentinel(cwd, {
      run_id: "active-run",
      session_id: "active-session",
    });
    writeFileSync(
      join(stateDir, "pipeline-governance-artifact.json"),
      JSON.stringify(artifact),
      "utf8",
    );
    unlinkSync(join(stateDir, "workflow-intent.json"));
    unlinkSync(join(stateDir, "required-first-actions.json"));
    const target = join(stateDir, "obligation-target.json");
    writeFileSync(target, JSON.stringify({}), "utf8");
    symlinkSync(target, join(stateDir, "workflow-intent.json"));
    symlinkSync(target, join(stateDir, "required-first-actions.json"));

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "FINAL_REVIEW: GO",
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("workflow_intent_integrity:hmac-sha256");
    expect(output.stopReason).toContain("required_first_actions_integrity:hmac-sha256");
  });

  it("TDD: blocks final PASS when active workflow obligation integrity is missing", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-obligation-integrity-"));
    const artifact = {
      ...validArtifact(),
      run_id: "current-run",
      session_id: "current-session",
    };
    const stateDir = writeLedgerProof(cwd, artifact);
    writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });
    writeFileSync(
      join(stateDir, "workflow-intent.json"),
      JSON.stringify({
        schema_version: 1,
        status: "active",
        plugin: "pipeline-orchestrator-for-codex",
        workflow: "bugfix-heavy",
        run_id: "current-run",
        session_id: "current-session",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      }),
      "utf8",
    );

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE",
        pipelineGovernanceArtifact: artifact,
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("workflow_intent_integrity:hmac-sha256");
  });

  it("TDD: blocks structured BLOCKED artifacts when active workflow obligation integrity is missing", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-blocked-obligation-integrity-"));
    const stateDir = writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });
    writeFileSync(
      join(stateDir, "workflow-intent.json"),
      JSON.stringify({
        schema_version: 1,
        status: "active",
        plugin: "pipeline-orchestrator-for-codex",
        workflow: "bugfix-heavy",
        run_id: "current-run",
        session_id: "current-session",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      }),
      "utf8",
    );

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "blocked-no-agent-runtime",
        pipelineGovernanceArtifact: blockedNoAgentRuntimeArtifact(),
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("workflow_intent_integrity:hmac-sha256");
  });

  it("TDD: blocks structured BLOCKED artifacts when obligation status is tampered before integrity check", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-tampered-obligation-status-"));
    const stateDir = writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });
    writeFileSync(
      join(stateDir, "workflow-intent.json"),
      JSON.stringify({
        schema_version: 1,
        status: "inactive",
        plugin: "pipeline-orchestrator-for-codex",
        workflow: "bugfix-heavy",
        run_id: "current-run",
        session_id: "current-session",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        _integrity: {
          algorithm: "hmac-sha256",
          scope: "pipeline-workflow-intent",
          signature: "0".repeat(64),
        },
      }),
      "utf8",
    );

    const output = runHook(cwd, {
      cwd,
      input: "/pipeline-orchestrator-for-codex:pipeline corrigir fluxo",
      output: {
        text: "blocked-no-agent-runtime",
        pipelineGovernanceArtifact: blockedNoAgentRuntimeArtifact(),
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("workflow_intent_integrity:hmac-sha256");
  });

  it("TDD: blocks structured BLOCKED artifacts when required-first-actions integrity is tampered", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-tampered-required-actions-"));
    const stateDir = writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });
    writeFileSync(
      join(stateDir, "required-first-actions.json"),
      JSON.stringify({
        schema_version: 1,
        status: "inactive",
        plugin: "pipeline-orchestrator-for-codex",
        workflow: "bugfix-heavy",
        run_id: "current-run",
        session_id: "current-session",
        required_actions: ["update_plan", "WORKFLOW_METHOD_GATE", "CAPABILITY_GATE"],
        completed_actions: [],
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        _integrity: {
          algorithm: "hmac-sha256",
          scope: "pipeline-required-first-actions",
          signature: "0".repeat(64),
        },
      }),
      "utf8",
    );

    const output = runHook(cwd, {
      cwd,
      input: "/pipeline-orchestrator-for-codex:pipeline corrigir fluxo",
      output: {
        text: "blocked-no-agent-runtime",
        pipelineGovernanceArtifact: blockedNoAgentRuntimeArtifact(),
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("required_first_actions_integrity:hmac-sha256");
  });

  it("TDD: blocks structured BLOCKED artifacts when canonical obligation files are destroyed", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-destroyed-obligation-files-"));
    const stateDir = writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });
    writeFileSync(join(stateDir, "workflow-intent.json"), "{}", "utf8");
    writeFileSync(join(stateDir, "required-first-actions.json"), "{}", "utf8");

    const output = runHook(cwd, {
      cwd,
      input: "/pipeline-orchestrator-for-codex:pipeline corrigir fluxo",
      output: {
        text: "blocked-no-agent-runtime",
        pipelineGovernanceArtifact: blockedNoAgentRuntimeArtifact(),
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("workflow_intent_integrity:hmac-sha256");
    expect(output.stopReason).toContain("required_first_actions_integrity:hmac-sha256");
  });

  it("TDD: blocks unsigned local ledgers even when they match the signed sentinel identity", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-unsigned-ledger-"));
    const artifact = {
      ...validArtifact(),
      run_id: "current-run",
      session_id: "current-session",
    };
    writeLedgerProof(cwd, artifact, { signedLedgerEntries: false });
    writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE",
        pipelineGovernanceArtifact: artifact,
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("ledger:gate:CAPABILITY_GATE");
    expect(output.stopReason).toContain("ledger:wait_agent:primary_reviewer");
  });

  it("TDD: blocks local ledgers with malformed HMAC signatures", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-malformed-ledger-hmac-"));
    const artifact = {
      ...validArtifact(),
      run_id: "current-run",
      session_id: "current-session",
    };
    writeLedgerProof(cwd, artifact, { corruptLedgerSignature: true });
    writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE",
        pipelineGovernanceArtifact: artifact,
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("ledger:gate:CAPABILITY_GATE");
    expect(output.stopReason).toContain("ledger:wait_agent:primary_reviewer");
  });

  it("TDD: blocks signed dispatch and wait ledgers that do not target the required reviewer role", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-wrong-agent-role-"));
    const artifact = {
      ...validArtifact(),
      run_id: "current-run",
      session_id: "current-session",
    };
    writeLedgerProof(cwd, artifact, {
      protocolTargetName: (role) => `ordinary_worker_for_${role}`,
    });
    writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE",
        pipelineGovernanceArtifact: artifact,
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("ledger:dispatch:primary_reviewer");
    expect(output.stopReason).toContain("ledger:wait_agent:primary_reviewer");
  });

  it("TDD: blocks PASS artifacts when the signed sentinel has no active identity and session state is absent", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-no-active-identity-pass-"));
    const artifact = {
      ...validArtifact(),
      run_id: "old-run",
      session_id: "old-session",
    };
    writeLedgerProof(cwd, artifact);

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "FINAL_REVIEW: GO",
        pipelineGovernanceArtifact: artifact,
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("current_run_identity");
  });

  it("TDD: blocks stale PASS ledgers when only unrelated noise carries the current run identity", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-stale-ledger-noise-"));
    const staleArtifact = {
      ...validArtifact(),
      run_id: "old-run",
      session_id: "old-session",
    };
    const stateDir = writeLedgerProof(cwd, staleArtifact);
    writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });
    appendFileSync(
      join(stateDir, "hook-events.jsonl"),
      JSON.stringify({
        hook: "noise",
        event: "unrelated",
        status: "PASS",
        run_id: "current-run",
      }) + "\n",
      "utf8",
    );

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE",
        pipelineGovernanceArtifact: {
          ...validArtifact(),
          run_id: "current-run",
          session_id: "current-session",
        },
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("current_run_identity");
  });

  it("TDD: blocks stale PASS ledgers when a current run id is injected through a different alias", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-stale-ledger-alias-"));
    const mixedAliasLedgerArtifact = {
      ...validArtifact(),
      runId: "current-run",
      sessionId: "old-session",
    };
    writeLedgerProof(cwd, mixedAliasLedgerArtifact);
    writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE",
        pipelineGovernanceArtifact: {
          ...validArtifact(),
          run_id: "current-run",
          session_id: "current-session",
        },
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("current_run_identity");
  });

  it("TDD: blocks PASS artifacts that carry stale and current identities through aliases", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-artifact-conflicting-aliases-"));
    const artifact = {
      ...validArtifact(),
      run_id: "old-run",
      session_id: "old-session",
      runId: "current-run",
      sessionId: "current-session",
    };
    writeLedgerProof(cwd, {
      ...validArtifact(),
      run_id: "current-run",
      session_id: "current-session",
    });
    writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE",
        pipelineGovernanceArtifact: artifact,
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("current_run_identity");
  });

  it("TDD: blocks matched ledger proof entries that carry stale and current identities through aliases", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-ledger-conflicting-aliases-"));
    const contaminatedLedgerArtifact = {
      ...validArtifact(),
      run_id: "old-run",
      session_id: "old-session",
      runId: "current-run",
      sessionId: "current-session",
    };
    writeLedgerProof(cwd, contaminatedLedgerArtifact);
    writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE",
        pipelineGovernanceArtifact: {
          ...validArtifact(),
          run_id: "current-run",
          session_id: "current-session",
        },
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("current_run_identity");
  });

  it("TDD: allows PASS when every matched ledger proof carries the current strong identity", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-current-strong-ledger-"));
    const artifact = {
      ...validArtifact(),
      run_id: "current-run",
      session_id: "current-session",
    };
    writeLedgerProof(cwd, artifact);
    writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });

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

  it("TDD: blocks PASS with stale run_id when active state only retained sessionId", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-partial-active-session-only-"));
    const artifact = {
      ...validArtifact(),
      run_id: "old-run",
      session_id: "current-session",
    };
    const stateDir = writeLedgerProof(cwd, artifact);
    writeActiveSentinel(cwd);
    writeFileSync(
      join(stateDir, "session.json"),
      JSON.stringify({
        pipelineActive: true,
        currentPhase: "phase-3",
        sessionId: "current-session",
      }),
      "utf8",
    );

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE",
        pipelineGovernanceArtifact: artifact,
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("current_run_identity");
  });

  it("TDD: blocks locally fabricated PASS ledgers when sentinel HMAC integrity is unavailable", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-forged-ledger-no-hmac-"));
    const artifact = {
      ...validArtifact(),
      run_id: "current-run",
      session_id: "current-session",
    };
    writeLedgerProof(cwd, artifact);
    writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE",
        pipelineGovernanceArtifact: artifact,
      },
    }, { PIPELINE_SENTINEL_HMAC_KEY: "" });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("sentinel_integrity:hmac-sha256");
  });

  it("TDD: accepts signed sentinel integrity from the shared ledger HMAC key", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-shared-hmac-sentinel-"));
    const artifact = {
      ...validArtifact(),
      run_id: "current-run",
      session_id: "current-session",
    };
    writeLedgerProof(cwd, artifact);
    writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE",
        pipelineGovernanceArtifact: artifact,
      },
    }, {
      PIPELINE_SENTINEL_HMAC_KEY: "",
      PIPELINE_INTEGRITY_HMAC_KEY: TEST_HMAC_KEY,
    });

    expect(output.continue).toBe(true);
  });

  it("TDD: blocks malformed sentinel HMAC signatures before accepting PASS ledgers", () => {
    const cwd = mkdtempSync(join(tmpdir(), "completion-checklist-malformed-sentinel-hmac-"));
    const artifact = {
      ...validArtifact(),
      run_id: "current-run",
      session_id: "current-session",
    };
    const stateDir = writeLedgerProof(cwd, artifact);
    writeActiveSentinel(cwd, {
      run_id: "current-run",
      session_id: "current-session",
    });
    const sentinelPath = join(stateDir, "sentinel-state.json");
    const sentinel = JSON.parse(readFileSync(sentinelPath, "utf8")) as {
      _integrity: { signature: string };
    };
    sentinel._integrity.signature = `${sentinel._integrity.signature}zz`;
    writeFileSync(sentinelPath, JSON.stringify(sentinel), "utf8");

    const output = runHook(cwd, {
      cwd,
      output: {
        text: "PIPELINE COMPLETE",
        pipelineGovernanceArtifact: artifact,
      },
    });

    expect(output.continue).toBe(false);
    expect(output.stopReason).toContain("sentinel_integrity:hmac-sha256");
  });
});
