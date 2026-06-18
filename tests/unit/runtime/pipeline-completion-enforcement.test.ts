import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPipelineRuntime } from "../../../src/index.js";
import { createPassingPipelineArtifact } from "../../../src/governance/pipeline-contract.js";

const TEST_HMAC_KEY = "pipeline-completion-runtime-test-key";
const ORIGINAL_PIPELINE_INTEGRITY_HMAC_KEY = process.env.PIPELINE_INTEGRITY_HMAC_KEY;
const ORIGINAL_PIPELINE_SENTINEL_HMAC_KEY = process.env.PIPELINE_SENTINEL_HMAC_KEY;

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

function signLedgerEntry<T extends Record<string, unknown>>(entry: T): T {
  const unsignedEntry = { ...entry };
  delete unsignedEntry._integrity;
  return {
    ...unsignedEntry,
    _integrity: {
      algorithm: "hmac-sha256",
      scope: "pipeline-ledger-entry",
      signature: createHmac("sha256", TEST_HMAC_KEY).update(canonicalize(unsignedEntry)).digest("hex"),
    },
  } as T;
}

function signSentinelState(state: Record<string, unknown>) {
  return {
    ...state,
    _integrity: {
      algorithm: "hmac-sha256",
      signature: createHmac("sha256", TEST_HMAC_KEY).update(canonicalize(state)).digest("hex"),
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

function writeSentinelRuntimeState(
  stateDir: string,
  state: Record<string, unknown>,
  options: { signedSentinel?: boolean } = {},
) {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    join(stateDir, "sentinel-state.json"),
    JSON.stringify(options.signedSentinel === false ? state : signSentinelState(state)),
    "utf8",
  );
}

function writeLedgerProof(
  stateDir: string,
  artifact = createPassingPipelineArtifact({ testOnly: true }),
  options: {
    hookEvents?: boolean;
    waitEvents?: boolean;
    dispatchMode?: "real" | "emulated";
    signedLedgerEntries?: boolean;
    protocolTargetName?: (role: string) => string;
    ledgerIdentity?: Record<string, string>;
  } = {},
) {
  const dispatchMode = options.dispatchMode ?? "real";
  const identityFields = options.ledgerIdentity ?? artifactIdentityFields(artifact as unknown as Record<string, unknown>);
  const maybeSignLedger = <T extends Record<string, unknown>>(entry: T) => (
    options.signedLedgerEntries === false ? entry : signLedgerEntry(entry)
  );
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    join(stateDir, "gate-decisions.jsonl"),
    artifact.gates.map((gate) => JSON.stringify(maybeSignLedger({
      gate: gate.gate,
      decision: "pass",
      status: "PASS",
      ...identityFields,
    }))).join("\n") + "\n",
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
}

function writeActiveRuntimeState(
  stateDir: string,
  identity: { run_id: string; session_id: string; workflow_id?: string },
  options: { signedSentinel?: boolean } = {},
) {
  mkdirSync(stateDir, { recursive: true });
  const sentinelState = {
    pipelineActive: true,
    currentPhase: "phase-3",
    expectedNext: ["final_verdict"],
    run_id: identity.run_id,
    session_id: identity.session_id,
    ...(identity.workflow_id ? { workflow_id: identity.workflow_id } : {}),
  };
  writeSentinelRuntimeState(stateDir, sentinelState, options);
  writeFileSync(
    join(stateDir, "session.json"),
    JSON.stringify({
      pipelineActive: true,
      currentPhase: "phase-3",
      sessionId: identity.session_id,
      run_id: identity.run_id,
      ...(identity.workflow_id ? { workflow_id: identity.workflow_id } : {}),
    }),
    "utf8",
  );
}

function writeSessionOnlyActiveRuntimeState(stateDir: string, sessionId: string) {
  mkdirSync(stateDir, { recursive: true });
  const sentinelState = {
    pipelineActive: true,
    currentPhase: "phase-3",
    expectedNext: ["final_verdict"],
  };
  writeSentinelRuntimeState(stateDir, sentinelState);
  writeFileSync(
    join(stateDir, "session.json"),
    JSON.stringify({
      pipelineActive: true,
      currentPhase: "phase-3",
      sessionId,
    }),
    "utf8",
  );
}

describe("runtime pipeline completion enforcement", () => {
  beforeEach(() => {
    process.env.PIPELINE_INTEGRITY_HMAC_KEY = TEST_HMAC_KEY;
  });

  afterEach(() => {
    if (ORIGINAL_PIPELINE_INTEGRITY_HMAC_KEY === undefined) {
      delete process.env.PIPELINE_INTEGRITY_HMAC_KEY;
    } else {
      process.env.PIPELINE_INTEGRITY_HMAC_KEY = ORIGINAL_PIPELINE_INTEGRITY_HMAC_KEY;
    }
    if (ORIGINAL_PIPELINE_SENTINEL_HMAC_KEY === undefined) {
      delete process.env.PIPELINE_SENTINEL_HMAC_KEY;
    } else {
      process.env.PIPELINE_SENTINEL_HMAC_KEY = ORIGINAL_PIPELINE_SENTINEL_HMAC_KEY;
    }
  });

  it("RED: blocks PIPELINE COMPLETE without protocol and gate evidence", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-completion-enforcement-"));
    const runtime = createPipelineRuntime({
      cwd,
      codexHome: cwd,
      strictAgents: true,
      agentRuntime: {
        runtimeMode: "real-agent",
        capabilities: {
          spawnAgent: true,
          waitAgent: true,
          collectArtifacts: true,
          recordGates: true,
          recordCheckpoints: true,
          structuredFinalState: true,
        },
        async spawnAgent(request) {
          return {
            mode: "single-agent",
            role: request.role,
            output: {
              text: "PIPELINE COMPLETE",
              status: "approved",
            },
          };
        },
        async waitAgent(dispatch) {
          return dispatch;
        },
        async collectArtifacts(dispatches) {
          return dispatches.map((dispatch) => dispatch.output);
        },
      },
    });

    const result = await runtime.dispatcher.runRole({
      mode: "single-agent",
      role: "pipeline-controller",
      phase: "phase-3",
      prompt: "Finish the pipeline.",
      input: {
        request: "/pipeline-orchestrator-for-codex:pipeline fix completion evidence",
      },
      filesInScope: [],
      authorityLevel: "controller",
      freshContext: true,
      reviewOnly: false,
    });

    expect(result.output).toMatchObject({
      status: "blocked",
      protocolStatus: "blocked-missing-governance-evidence",
      blockedReason: expect.stringContaining("protocol-events"),
      pipeline_valid: false,
      manual_fallback_counts_as_pipeline: false,
    });
  });

  it("TDD: blocks PIPELINE_STATUS PASS closeout without a governance artifact", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-completion-status-pass-no-artifact-"));
    const runtime = createPipelineRuntime({
      cwd,
      codexHome: cwd,
      strictAgents: true,
      agentRuntime: {
        runtimeMode: "real-agent",
        capabilities: {
          spawnAgent: true,
          waitAgent: true,
          collectArtifacts: true,
          recordGates: true,
          recordCheckpoints: true,
          structuredFinalState: true,
        },
        async spawnAgent(request) {
          return {
            mode: "single-agent",
            role: request.role,
            output: {
              text: "SUMMARY\nPIPELINE_STATUS: PASS\nNo P0/P1/P2 findings remain.",
              status: "approved",
            },
          };
        },
        async waitAgent(dispatch) {
          return dispatch;
        },
        async collectArtifacts(dispatches) {
          return dispatches.map((dispatch) => dispatch.output);
        },
      },
    });

    const result = await runtime.dispatcher.runRole({
      mode: "single-agent",
      role: "pipeline-controller",
      phase: "phase-3",
      prompt: "Finish the pipeline.",
      input: {
        request: "/pipeline-orchestrator-for-codex:pipeline reject status pass closeout",
      },
      filesInScope: [],
      authorityLevel: "controller",
      freshContext: true,
      reviewOnly: false,
    });

    expect(result.output).toMatchObject({
      status: "blocked",
      protocolStatus: "blocked-missing-governance-evidence",
      blockedReason: expect.stringContaining("PipelineGovernanceArtifact"),
      pipeline_valid: false,
    });
  });

  it("blocks PIPELINE COMPLETE when a claimed valid artifact is missing required gates, hooks, and agents", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-completion-forged-artifact-"));
    const runtime = createPipelineRuntime({
      cwd,
      codexHome: cwd,
      strictAgents: true,
      agentRuntime: {
        runtimeMode: "real-agent",
        capabilities: {
          spawnAgent: true,
          waitAgent: true,
          collectArtifacts: true,
          recordGates: true,
          recordCheckpoints: true,
          structuredFinalState: true,
        },
        async spawnAgent(request) {
          return {
            mode: "single-agent",
            role: request.role,
            output: {
              text: "PIPELINE COMPLETE",
              status: "approved",
              pipelineGovernanceArtifact: {
                pipeline_requested: true,
                pipeline_valid: true,
                runtime_mode: "real-agent",
                hook_enforcement_mode: "blocking",
                exec_window_enforcement: "cooperative",
                status: "PASS",
                missing_capabilities: [],
                gates: [],
                hooks: [],
                agents: [],
                manual_fallback_counts_as_pipeline: false,
                final_verdict: {
                  status: "PASS",
                  reason: "forged",
                  evidence_ref: "forged",
                },
              },
            },
          };
        },
        async waitAgent(dispatch) {
          return dispatch;
        },
        async collectArtifacts(dispatches) {
          return dispatches.map((dispatch) => dispatch.output);
        },
      },
    });

    mkdirSync(runtime.stateDir, { recursive: true });
    writeFileSync(join(runtime.stateDir, "protocol-events.jsonl"), "{\"kind\":\"DISPATCH_RESULT\"}\n", "utf8");
    writeFileSync(join(runtime.stateDir, "gate-decisions.jsonl"), "{\"gate\":\"CAPABILITY_GATE\"}\n", "utf8");

    const result = await runtime.dispatcher.runRole({
      mode: "single-agent",
      role: "pipeline-controller",
      phase: "phase-3",
      prompt: "Finish the pipeline.",
      input: {
        request: "/pipeline-orchestrator-for-codex:pipeline fix forged artifact",
      },
      filesInScope: [],
      authorityLevel: "controller",
      freshContext: true,
      reviewOnly: false,
    });

    expect(result.output).toMatchObject({
      status: "blocked",
      protocolStatus: "blocked-missing-governance-evidence",
      blockedReason: expect.stringContaining("PipelineGovernanceArtifact"),
      pipeline_valid: false,
      manual_fallback_counts_as_pipeline: false,
    });
    expect(result.output.blockedReason).toContain("gate:CAPABILITY_GATE");
    expect(result.output.blockedReason).toContain("agent:primary_reviewer");
  });

  it("blocks Final decision: GO with pipeline_valid=true even without PIPELINE COMPLETE text", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-completion-final-go-"));
    const runtime = createPipelineRuntime({
      cwd,
      codexHome: cwd,
      strictAgents: true,
      agentRuntime: {
        runtimeMode: "real-agent",
        capabilities: {
          spawnAgent: true,
          waitAgent: true,
          collectArtifacts: true,
          recordGates: true,
          recordCheckpoints: true,
          structuredFinalState: true,
        },
        async spawnAgent(request) {
          return {
            mode: "single-agent",
            role: request.role,
            output: {
              text: "Final decision: GO",
              status: "approved",
              pipeline_valid: true,
              pipelineGovernanceArtifact: {
                pipeline_requested: true,
                pipeline_valid: true,
                runtime_mode: "real-agent",
                hook_enforcement_mode: "blocking",
                exec_window_enforcement: "cooperative",
                status: "PASS",
                missing_capabilities: [],
                gates: [],
                hooks: [],
                agents: [],
                manual_fallback_counts_as_pipeline: false,
                final_verdict: {
                  status: "PASS",
                  reason: "forged",
                  evidence_ref: "forged",
                },
              },
            },
          };
        },
        async waitAgent(dispatch) {
          return dispatch;
        },
        async collectArtifacts(dispatches) {
          return dispatches.map((dispatch) => dispatch.output);
        },
      },
    });

    const result = await runtime.dispatcher.runRole({
      mode: "single-agent",
      role: "pipeline-controller",
      phase: "phase-3",
      prompt: "Finish the pipeline.",
      input: {
        request: "/pipeline-orchestrator-for-codex:pipeline prove final decision gate",
      },
      filesInScope: [],
      authorityLevel: "controller",
      freshContext: true,
      reviewOnly: false,
    });

    expect(result.output).toMatchObject({
      status: "blocked",
      protocolStatus: "blocked-missing-governance-evidence",
      pipeline_valid: false,
      manual_fallback_counts_as_pipeline: false,
    });
    expect(result.output.blockedReason).toContain("PipelineGovernanceArtifact");
  });

  it("blocks governed shortcut commands that try to complete with invalid governance evidence", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-completion-audit-shortcut-"));
    const runtime = createPipelineRuntime({
      cwd,
      codexHome: cwd,
      strictAgents: true,
      agentRuntime: {
        runtimeMode: "real-agent",
        capabilities: {
          spawnAgent: true,
          waitAgent: true,
          collectArtifacts: true,
          recordGates: true,
          recordCheckpoints: true,
          structuredFinalState: true,
        },
        async spawnAgent(request) {
          return {
            mode: "single-agent",
            role: request.role,
            output: {
              text: "PIPELINE COMPLETE",
              status: "approved",
              pipeline_valid: true,
              pipelineGovernanceArtifact: {
                pipeline_requested: true,
                pipeline_valid: true,
                runtime_mode: "real-agent",
                hook_enforcement_mode: "blocking",
                exec_window_enforcement: "cooperative",
                status: "PASS",
                missing_capabilities: [],
                gates: [],
                hooks: [],
                agents: [],
                manual_fallback_counts_as_pipeline: false,
                final_verdict: {
                  status: "PASS",
                  reason: "forged",
                  evidence_ref: "forged",
                },
              },
            },
          };
        },
        async waitAgent(dispatch) {
          return dispatch;
        },
        async collectArtifacts(dispatches) {
          return dispatches.map((dispatch) => dispatch.output);
        },
      },
    });

    const result = await runtime.dispatcher.runRole({
      mode: "single-agent",
      role: "pipeline-controller",
      phase: "phase-3",
      prompt: "Finish the audit workflow.",
      input: {
        request: "/pipeline-orchestrator-for-codex:audit review enforcement",
      },
      filesInScope: [],
      authorityLevel: "controller",
      freshContext: true,
      reviewOnly: false,
    });

    expect(result.output).toMatchObject({
      status: "blocked",
      protocolStatus: "blocked-missing-governance-evidence",
      pipeline_valid: false,
    });
    expect(result.output.blockedReason).toContain("PipelineGovernanceArtifact");
  });

  it("blocks PIPELINE COMPLETE when a complete-looking artifact is not backed by matching ledgers", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-completion-unbacked-artifact-"));
    const artifact = createPassingPipelineArtifact({ testOnly: true });
    const runtime = createPipelineRuntime({
      cwd,
      codexHome: cwd,
      strictAgents: true,
      agentRuntime: {
        runtimeMode: "real-agent",
        capabilities: {
          spawnAgent: true,
          waitAgent: true,
          collectArtifacts: true,
          recordGates: true,
          recordCheckpoints: true,
          structuredFinalState: true,
        },
        async spawnAgent(request) {
          return {
            mode: "single-agent",
            role: request.role,
            output: {
              text: "PIPELINE COMPLETE",
              status: "approved",
              pipelineGovernanceArtifact: artifact,
            },
          };
        },
        async waitAgent(dispatch) {
          return dispatch;
        },
        async collectArtifacts(dispatches) {
          return dispatches.map((dispatch) => dispatch.output);
        },
      },
    });

    mkdirSync(runtime.stateDir, { recursive: true });
    writeFileSync(join(runtime.stateDir, "protocol-events.jsonl"), "{\"kind\":\"DISPATCH_RESULT\"}\n", "utf8");
    writeFileSync(join(runtime.stateDir, "gate-decisions.jsonl"), "{\"gate\":\"CAPABILITY_GATE\"}\n", "utf8");

    const result = await runtime.dispatcher.runRole({
      mode: "single-agent",
      role: "pipeline-controller",
      phase: "phase-3",
      prompt: "Finish the pipeline.",
      input: {
        request: "/pipeline-orchestrator-for-codex:pipeline fix unbacked artifact",
      },
      filesInScope: [],
      authorityLevel: "controller",
      freshContext: true,
      reviewOnly: false,
    });

    expect(result.output).toMatchObject({
      status: "blocked",
      protocolStatus: "blocked-missing-governance-evidence",
      pipeline_valid: false,
    });
    expect(result.output.blockedReason).toContain("ledger:gate:CAPABILITY_GATE");
    expect(result.output.blockedReason).toContain("ledger:wait_agent:primary_reviewer");
  });

  it("blocks PIPELINE COMPLETE when checkpoint files exist but hook-events are missing", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-completion-missing-hook-events-"));
    const artifact = createPassingPipelineArtifact({ testOnly: true });
    const runtime = createPipelineRuntime({
      cwd,
      codexHome: cwd,
      strictAgents: true,
      agentRuntime: {
        runtimeMode: "real-agent",
        capabilities: {
          spawnAgent: true,
          waitAgent: true,
          collectArtifacts: true,
          recordGates: true,
          recordCheckpoints: true,
          structuredFinalState: true,
        },
        async spawnAgent(request) {
          return {
            mode: "single-agent",
            role: request.role,
            output: {
              text: "PIPELINE COMPLETE",
              status: "approved",
              pipelineGovernanceArtifact: artifact,
            },
          };
        },
        async waitAgent(dispatch) {
          return dispatch;
        },
        async collectArtifacts(dispatches) {
          return dispatches.map((dispatch) => dispatch.output);
        },
      },
    });
    writeLedgerProof(runtime.stateDir, artifact, { hookEvents: false });

    const result = await runtime.dispatcher.runRole({
      mode: "single-agent",
      role: "pipeline-controller",
      phase: "phase-3",
      prompt: "Finish the pipeline.",
      input: {
        request: "/pipeline-orchestrator-for-codex:pipeline prove hook event requirement",
      },
      filesInScope: [],
      authorityLevel: "controller",
      freshContext: true,
      reviewOnly: false,
    });

    expect(result.output).toMatchObject({
      status: "blocked",
      protocolStatus: "blocked-missing-governance-evidence",
      pipeline_valid: false,
    });
    expect(result.output.blockedReason).toContain("hook-events.jsonl");
    expect(result.output.blockedReason).toContain("ledger:hook:intake:before");
  });

  it("blocks PIPELINE COMPLETE when dispatch ledger exists but wait_agent ledger is missing", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-completion-missing-wait-ledger-"));
    const artifact = createPassingPipelineArtifact({ testOnly: true });
    const runtime = createPipelineRuntime({
      cwd,
      codexHome: cwd,
      strictAgents: true,
      agentRuntime: {
        runtimeMode: "real-agent",
        capabilities: {
          spawnAgent: true,
          waitAgent: true,
          collectArtifacts: true,
          recordGates: true,
          recordCheckpoints: true,
          structuredFinalState: true,
        },
        async spawnAgent(request) {
          return {
            mode: "single-agent",
            role: request.role,
            output: {
              text: "PIPELINE COMPLETE",
              status: "approved",
              pipelineGovernanceArtifact: artifact,
            },
          };
        },
        async waitAgent(dispatch) {
          return dispatch;
        },
        async collectArtifacts(dispatches) {
          return dispatches.map((dispatch) => dispatch.output);
        },
      },
    });
    writeLedgerProof(runtime.stateDir, artifact, { waitEvents: false });

    const result = await runtime.dispatcher.runRole({
      mode: "single-agent",
      role: "pipeline-controller",
      phase: "phase-3",
      prompt: "Finish the pipeline.",
      input: {
        request: "/pipeline-orchestrator-for-codex:pipeline prove wait ledger requirement",
      },
      filesInScope: [],
      authorityLevel: "controller",
      freshContext: true,
      reviewOnly: false,
    });

    expect(result.output).toMatchObject({
      status: "blocked",
      protocolStatus: "blocked-missing-governance-evidence",
      pipeline_valid: false,
    });
    expect(result.output.blockedReason).toContain("ledger:wait_agent:primary_reviewer");
  });

  it("blocks PIPELINE COMPLETE when WAIT_AGENT_COMPLETED is hidden inside the dispatch completion line", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-completion-hidden-wait-"));
    const artifact = createPassingPipelineArtifact({ testOnly: true });
    const runtime = createPipelineRuntime({
      cwd,
      codexHome: cwd,
      strictAgents: true,
      agentRuntime: {
        runtimeMode: "real-agent",
        capabilities: {
          spawnAgent: true,
          waitAgent: true,
          collectArtifacts: true,
          recordGates: true,
          recordCheckpoints: true,
          structuredFinalState: true,
        },
        async spawnAgent(request) {
          return {
            mode: "single-agent",
            role: request.role,
            output: {
              text: "PIPELINE COMPLETE",
              status: "approved",
              pipelineGovernanceArtifact: artifact,
            },
          };
        },
        async waitAgent(dispatch) {
          return dispatch;
        },
        async collectArtifacts(dispatches) {
          return dispatches.map((dispatch) => dispatch.output);
        },
      },
    });
    writeLedgerProof(runtime.stateDir, artifact, { waitEvents: false });
    writeFileSync(
      join(runtime.stateDir, "protocol-events.jsonl"),
      artifact.agents.map((agent) => {
        const dispatchId = agent.dispatch_ref.replace(/^dispatch:/u, "");
        return JSON.stringify({
          event_id: `dispatch-request-${dispatchId}-completed`,
          kind: "DISPATCH_REQUEST",
          status: "completed",
          dispatchMode: "real",
          payload: {
            event: "DISPATCH_COMPLETED",
            dispatchId,
            targetName: agent.role,
            output: {
              text: "WAIT_AGENT_COMPLETED wait_agent",
            },
          },
        });
      }).join("\n") + "\n",
      "utf8",
    );

    const result = await runtime.dispatcher.runRole({
      mode: "single-agent",
      role: "pipeline-controller",
      phase: "phase-3",
      prompt: "Finish the pipeline.",
      input: {
        request: "/pipeline-orchestrator-for-codex:pipeline reject hidden wait proof",
      },
      filesInScope: [],
      authorityLevel: "controller",
      freshContext: true,
      reviewOnly: false,
    });

    expect(result.output).toMatchObject({
      status: "blocked",
      protocolStatus: "blocked-missing-governance-evidence",
      pipeline_valid: false,
    });
    expect(result.output.blockedReason).toContain("ledger:wait_agent:primary_reviewer");
  });

  it("blocks PIPELINE COMPLETE from a dev-bypass adapter even with forged real-looking ledgers", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-completion-dev-bypass-"));
    const artifact = createPassingPipelineArtifact({ testOnly: true });
    const runtime = createPipelineRuntime({
      cwd,
      codexHome: cwd,
      strictAgents: true,
      agentRuntime: {
        runtimeMode: "dev-bypass",
        capabilities: {
          spawnAgent: true,
          waitAgent: true,
          collectArtifacts: true,
          recordGates: true,
          recordCheckpoints: true,
          structuredFinalState: true,
        },
        async spawnAgent(request) {
          return {
            mode: "single-agent",
            role: request.role,
            output: {
              text: "PIPELINE COMPLETE",
              status: "approved",
              pipelineGovernanceArtifact: artifact,
            },
          };
        },
        async waitAgent(dispatch) {
          return dispatch;
        },
        async collectArtifacts(dispatches) {
          return dispatches.map((dispatch) => dispatch.output);
        },
      },
    });
    writeSentinelRuntimeState(runtime.stateDir, {
      pipelineActive: true,
      currentPhase: "phase-3",
      expectedNext: ["final_verdict"],
    });
    writeLedgerProof(runtime.stateDir, artifact);

    const result = await runtime.dispatcher.runRole({
      mode: "single-agent",
      role: "pipeline-controller",
      phase: "phase-3",
      prompt: "Finish the pipeline.",
      input: {
        request: "/pipeline-orchestrator-for-codex:pipeline reject dev bypass",
      },
      filesInScope: [],
      authorityLevel: "controller",
      freshContext: true,
      reviewOnly: false,
    });

    expect(result.output).toMatchObject({
      status: "blocked",
      protocolStatus: "blocked-missing-governance-evidence",
      pipeline_valid: false,
    });
    expect(result.output.blockedReason).toContain("runtime_mode:dev-bypass");
  });

  it("allows PIPELINE COMPLETE only when the artifact and runtime ledgers match", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-completion-ledger-backed-"));
    const artifact = {
      ...createPassingPipelineArtifact({ testOnly: true }),
      run_id: "current-run",
      session_id: "current-session",
    };
    const runtime = createPipelineRuntime({
      cwd,
      codexHome: cwd,
      strictAgents: true,
      agentRuntime: {
        runtimeMode: "real-agent",
        capabilities: {
          spawnAgent: true,
          waitAgent: true,
          collectArtifacts: true,
          recordGates: true,
          recordCheckpoints: true,
          structuredFinalState: true,
        },
        async spawnAgent(request) {
          return {
            mode: "single-agent",
            role: request.role,
            output: {
              text: "PIPELINE COMPLETE",
              status: "approved",
              pipelineGovernanceArtifact: artifact,
            },
          };
        },
        async waitAgent(dispatch) {
          return dispatch;
        },
        async collectArtifacts(dispatches) {
          return dispatches.map((dispatch) => dispatch.output);
        },
      },
    });
    writeActiveRuntimeState(runtime.stateDir, {
      run_id: "current-run",
      session_id: "current-session",
    });
    writeLedgerProof(runtime.stateDir, artifact);

    const result = await runtime.dispatcher.runRole({
      mode: "single-agent",
      role: "pipeline-controller",
      phase: "phase-3",
      prompt: "Finish the pipeline.",
      input: {
        request: "/pipeline-orchestrator-for-codex:pipeline fix backed artifact",
      },
      filesInScope: [],
      authorityLevel: "controller",
      freshContext: true,
      reviewOnly: false,
    });

    expect(result.output).toMatchObject({
      status: "approved",
      pipelineGovernanceArtifact: {
        pipeline_valid: true,
      },
    });
  });

  it("TDD: blocks PIPELINE COMPLETE when only the shared integrity key is configured and sentinel is unsigned", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-completion-shared-key-unsigned-sentinel-"));
    const artifact = {
      ...createPassingPipelineArtifact({ testOnly: true }),
      run_id: "current-run",
      session_id: "current-session",
    };
    const runtime = createPipelineRuntime({
      cwd,
      codexHome: cwd,
      strictAgents: true,
      agentRuntime: {
        runtimeMode: "real-agent",
        capabilities: {
          spawnAgent: true,
          waitAgent: true,
          collectArtifacts: true,
          recordGates: true,
          recordCheckpoints: true,
          structuredFinalState: true,
        },
        async spawnAgent(request) {
          return {
            mode: "single-agent",
            role: request.role,
            output: {
              text: "PIPELINE COMPLETE",
              status: "approved",
              pipelineGovernanceArtifact: artifact,
            },
          };
        },
        async waitAgent(dispatch) {
          return dispatch;
        },
        async collectArtifacts(dispatches) {
          return dispatches.map((dispatch) => dispatch.output);
        },
      },
    });
    writeActiveRuntimeState(runtime.stateDir, {
      run_id: "current-run",
      session_id: "current-session",
    }, { signedSentinel: false });
    writeLedgerProof(runtime.stateDir, artifact);

    const result = await runtime.dispatcher.runRole({
      mode: "single-agent",
      role: "pipeline-controller",
      phase: "phase-3",
      prompt: "Finish the pipeline.",
      input: {
        request: "/pipeline-orchestrator-for-codex:pipeline reject shared-key unsigned sentinel",
      },
      filesInScope: [],
      authorityLevel: "controller",
      freshContext: true,
      reviewOnly: false,
    });

    expect(result.output).toMatchObject({
      status: "blocked",
      protocolStatus: "blocked-missing-governance-evidence",
      pipeline_valid: false,
    });
    expect(result.output.blockedReason).toContain("sentinel_integrity:hmac-sha256");
  });

  it("TDD: blocks PIPELINE COMPLETE when runtime ledgers are unsigned", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-completion-unsigned-ledger-"));
    const artifact = createPassingPipelineArtifact({ testOnly: true });
    const runtime = createPipelineRuntime({
      cwd,
      codexHome: cwd,
      strictAgents: true,
      agentRuntime: {
        runtimeMode: "real-agent",
        capabilities: {
          spawnAgent: true,
          waitAgent: true,
          collectArtifacts: true,
          recordGates: true,
          recordCheckpoints: true,
          structuredFinalState: true,
        },
        async spawnAgent(request) {
          return {
            mode: "single-agent",
            role: request.role,
            output: {
              text: "PIPELINE COMPLETE",
              status: "approved",
              pipelineGovernanceArtifact: artifact,
            },
          };
        },
        async waitAgent(dispatch) {
          return dispatch;
        },
        async collectArtifacts(dispatches) {
          return dispatches.map((dispatch) => dispatch.output);
        },
      },
    });
    writeLedgerProof(runtime.stateDir, artifact, { signedLedgerEntries: false });

    const result = await runtime.dispatcher.runRole({
      mode: "single-agent",
      role: "pipeline-controller",
      phase: "phase-3",
      prompt: "Finish the pipeline.",
      input: {
        request: "/pipeline-orchestrator-for-codex:pipeline reject unsigned ledgers",
      },
      filesInScope: [],
      authorityLevel: "controller",
      freshContext: true,
      reviewOnly: false,
    });

    expect(result.output).toMatchObject({
      status: "blocked",
      protocolStatus: "blocked-missing-governance-evidence",
      pipeline_valid: false,
    });
    expect(result.output.blockedReason).toContain("ledger:gate:CAPABILITY_GATE");
    expect(result.output.blockedReason).toContain("ledger:wait_agent:primary_reviewer");
  });

  it("TDD: blocks PIPELINE COMPLETE when signed dispatch ledgers target a different agent role", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-completion-wrong-agent-role-"));
    const artifact = createPassingPipelineArtifact({ testOnly: true });
    const runtime = createPipelineRuntime({
      cwd,
      codexHome: cwd,
      strictAgents: true,
      agentRuntime: {
        runtimeMode: "real-agent",
        capabilities: {
          spawnAgent: true,
          waitAgent: true,
          collectArtifacts: true,
          recordGates: true,
          recordCheckpoints: true,
          structuredFinalState: true,
        },
        async spawnAgent(request) {
          return {
            mode: "single-agent",
            role: request.role,
            output: {
              text: "PIPELINE COMPLETE",
              status: "approved",
              pipelineGovernanceArtifact: artifact,
            },
          };
        },
        async waitAgent(dispatch) {
          return dispatch;
        },
        async collectArtifacts(dispatches) {
          return dispatches.map((dispatch) => dispatch.output);
        },
      },
    });
    writeLedgerProof(runtime.stateDir, artifact, {
      protocolTargetName: (role) => `ordinary_worker_for_${role}`,
    });

    const result = await runtime.dispatcher.runRole({
      mode: "single-agent",
      role: "pipeline-controller",
      phase: "phase-3",
      prompt: "Finish the pipeline.",
      input: {
        request: "/pipeline-orchestrator-for-codex:pipeline reject wrong agent ledgers",
      },
      filesInScope: [],
      authorityLevel: "controller",
      freshContext: true,
      reviewOnly: false,
    });

    expect(result.output).toMatchObject({
      status: "blocked",
      protocolStatus: "blocked-missing-governance-evidence",
      pipeline_valid: false,
    });
    expect(result.output.blockedReason).toContain("ledger:dispatch:primary_reviewer");
    expect(result.output.blockedReason).toContain("ledger:wait_agent:primary_reviewer");
  });

  it("TDD: blocks PIPELINE COMPLETE when signed runtime ledgers belong to an older run identity", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-completion-stale-signed-ledger-"));
    const artifact = {
      ...createPassingPipelineArtifact({ testOnly: true }),
      run_id: "current-run",
      session_id: "current-session",
    };
    const runtime = createPipelineRuntime({
      cwd,
      codexHome: cwd,
      strictAgents: true,
      agentRuntime: {
        runtimeMode: "real-agent",
        capabilities: {
          spawnAgent: true,
          waitAgent: true,
          collectArtifacts: true,
          recordGates: true,
          recordCheckpoints: true,
          structuredFinalState: true,
        },
        async spawnAgent(request) {
          return {
            mode: "single-agent",
            role: request.role,
            output: {
              text: "PIPELINE COMPLETE",
              status: "approved",
              pipelineGovernanceArtifact: artifact,
            },
          };
        },
        async waitAgent(dispatch) {
          return dispatch;
        },
        async collectArtifacts(dispatches) {
          return dispatches.map((dispatch) => dispatch.output);
        },
      },
    });
    writeLedgerProof(runtime.stateDir, artifact, {
      ledgerIdentity: {
        run_id: "old-run",
        session_id: "old-session",
      },
    });

    const result = await runtime.dispatcher.runRole({
      mode: "single-agent",
      role: "pipeline-controller",
      phase: "phase-3",
      prompt: "Finish the pipeline.",
      input: {
        request: "/pipeline-orchestrator-for-codex:pipeline reject stale signed ledgers",
      },
      filesInScope: [],
      authorityLevel: "controller",
      freshContext: true,
      reviewOnly: false,
    });

    expect(result.output).toMatchObject({
      status: "blocked",
      protocolStatus: "blocked-missing-governance-evidence",
      pipeline_valid: false,
    });
    expect(result.output.blockedReason).toContain("ledger:gate:CAPABILITY_GATE");
    expect(result.output.blockedReason).toContain("ledger:wait_agent:primary_reviewer");
  });

  it("TDD: blocks PIPELINE COMPLETE when a stale signed artifact and ledgers target a newer active run", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-completion-stale-artifact-active-run-"));
    const artifact = {
      ...createPassingPipelineArtifact({ testOnly: true }),
      run_id: "old-run",
      session_id: "old-session",
    };
    const runtime = createPipelineRuntime({
      cwd,
      codexHome: cwd,
      strictAgents: true,
      agentRuntime: {
        runtimeMode: "real-agent",
        capabilities: {
          spawnAgent: true,
          waitAgent: true,
          collectArtifacts: true,
          recordGates: true,
          recordCheckpoints: true,
          structuredFinalState: true,
        },
        async spawnAgent(request) {
          return {
            mode: "single-agent",
            role: request.role,
            output: {
              text: "PIPELINE COMPLETE",
              status: "approved",
              pipelineGovernanceArtifact: artifact,
            },
          };
        },
        async waitAgent(dispatch) {
          return dispatch;
        },
        async collectArtifacts(dispatches) {
          return dispatches.map((dispatch) => dispatch.output);
        },
      },
    });
    writeActiveRuntimeState(runtime.stateDir, {
      run_id: "current-run",
      session_id: "current-session",
    });
    writeLedgerProof(runtime.stateDir, artifact);

    const result = await runtime.dispatcher.runRole({
      mode: "single-agent",
      role: "pipeline-controller",
      phase: "phase-3",
      prompt: "Finish the pipeline.",
      input: {
        request: "/pipeline-orchestrator-for-codex:pipeline reject stale signed artifact",
      },
      filesInScope: [],
      authorityLevel: "controller",
      freshContext: true,
      reviewOnly: false,
    });

    expect(result.output).toMatchObject({
      status: "blocked",
      protocolStatus: "blocked-missing-governance-evidence",
      pipeline_valid: false,
    });
    expect(result.output.blockedReason).toContain("current_run_identity");
  });

  it("TDD: blocks stale PASS evidence when active runtime state only proves session identity", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-completion-stale-run-session-only-"));
    const artifact = {
      ...createPassingPipelineArtifact({ testOnly: true }),
      run_id: "old-run",
      session_id: "current-session",
    };
    const runtime = createPipelineRuntime({
      cwd,
      codexHome: cwd,
      strictAgents: true,
      agentRuntime: {
        runtimeMode: "real-agent",
        capabilities: {
          spawnAgent: true,
          waitAgent: true,
          collectArtifacts: true,
          recordGates: true,
          recordCheckpoints: true,
          structuredFinalState: true,
        },
        async spawnAgent(request) {
          return {
            mode: "single-agent",
            role: request.role,
            output: {
              text: "PIPELINE COMPLETE",
              status: "approved",
              pipelineGovernanceArtifact: artifact,
            },
          };
        },
        async waitAgent(dispatch) {
          return dispatch;
        },
        async collectArtifacts(dispatches) {
          return dispatches.map((dispatch) => dispatch.output);
        },
      },
    });
    writeSessionOnlyActiveRuntimeState(runtime.stateDir, "current-session");
    writeLedgerProof(runtime.stateDir, artifact);

    const result = await runtime.dispatcher.runRole({
      mode: "single-agent",
      role: "pipeline-controller",
      phase: "phase-3",
      prompt: "Finish the pipeline.",
      input: {
        request: "/pipeline-orchestrator-for-codex:pipeline reject partial active identity",
      },
      filesInScope: [],
      authorityLevel: "controller",
      freshContext: true,
      reviewOnly: false,
    });

    expect(result.output).toMatchObject({
      status: "blocked",
      protocolStatus: "blocked-missing-governance-evidence",
      pipeline_valid: false,
    });
    expect(result.output.blockedReason).toContain("current_run_identity");
  });

  it("TDD: blocks PASS evidence when runtime sentinel HMAC is malformed", async () => {
    process.env.PIPELINE_SENTINEL_HMAC_KEY = TEST_HMAC_KEY;
    const cwd = mkdtempSync(join(tmpdir(), "pipeline-completion-malformed-sentinel-hmac-"));
    const artifact = {
      ...createPassingPipelineArtifact({ testOnly: true }),
      run_id: "old-run",
      session_id: "old-session",
    };
    const runtime = createPipelineRuntime({
      cwd,
      codexHome: cwd,
      strictAgents: true,
      agentRuntime: {
        runtimeMode: "real-agent",
        capabilities: {
          spawnAgent: true,
          waitAgent: true,
          collectArtifacts: true,
          recordGates: true,
          recordCheckpoints: true,
          structuredFinalState: true,
        },
        async spawnAgent(request) {
          return {
            mode: "single-agent",
            role: request.role,
            output: {
              text: "PIPELINE COMPLETE",
              status: "approved",
              pipelineGovernanceArtifact: artifact,
            },
          };
        },
        async waitAgent(dispatch) {
          return dispatch;
        },
        async collectArtifacts(dispatches) {
          return dispatches.map((dispatch) => dispatch.output);
        },
      },
    });
    writeActiveRuntimeState(runtime.stateDir, {
      run_id: "old-run",
      session_id: "old-session",
    });
    const sentinelPath = join(runtime.stateDir, "sentinel-state.json");
    const sentinel = JSON.parse(readFileSync(sentinelPath, "utf8")) as Record<string, unknown>;
    const signedSentinel = signSentinelState(sentinel) as { _integrity: { signature: string } };
    signedSentinel._integrity.signature = `${signedSentinel._integrity.signature}zz`;
    writeFileSync(sentinelPath, JSON.stringify(signedSentinel), "utf8");
    writeLedgerProof(runtime.stateDir, artifact);

    const result = await runtime.dispatcher.runRole({
      mode: "single-agent",
      role: "pipeline-controller",
      phase: "phase-3",
      prompt: "Finish the pipeline.",
      input: {
        request: "/pipeline-orchestrator-for-codex:pipeline reject malformed sentinel hmac",
      },
      filesInScope: [],
      authorityLevel: "controller",
      freshContext: true,
      reviewOnly: false,
    });

    expect(result.output).toMatchObject({
      status: "blocked",
      protocolStatus: "blocked-missing-governance-evidence",
      pipeline_valid: false,
    });
    expect(result.output.blockedReason).toContain("sentinel_integrity:hmac-sha256");
  });
});
