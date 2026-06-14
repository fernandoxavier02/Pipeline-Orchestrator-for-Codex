import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCliExitCode, runPipelineCli } from "../../../src/cli/pipeline-cli.js";
import type { AgentRuntimeAdapter, DispatchResult } from "../../../src/dispatcher/dispatcher-types.js";
import { createSessionStore } from "../../../src/state/session-store.js";
import { createSentinelStateStore } from "../../../src/sentinel/sentinel-state.js";

function completeAgentRuntime(): AgentRuntimeAdapter {
  return {
    capabilities: {
      spawnAgent: true,
      waitAgent: true,
      collectArtifacts: true,
      recordGates: true,
      recordCheckpoints: true,
      structuredFinalState: true,
    },
    async spawnAgent(request: { role: string }) {
      return {
        mode: "single-agent",
        role: request.role,
        output: {
          status: "approved",
          dispatchMode: "real-agent",
        },
      };
    },
    async waitAgent(dispatch: DispatchResult) {
      return dispatch;
    },
    async collectArtifacts(dispatches: DispatchResult[]) {
      return dispatches.map((dispatch) => dispatch.output);
    },
  };
}

async function seedPendingProposal(
  root: string,
  response: string,
  overrides: {
    currentPhase?: "phase-1" | "phase-1.5";
    phaseAlias?: "phase-1" | "phase-1.5" | "phase-2";
    pendingDecision?: string;
    pipelineActive?: boolean;
    sentinelPhase?: "phase-1" | "phase-1.5" | "phase-2";
    currentAgent?: string;
    expectedNext?: string[];
    batchIndex?: number;
    sentinelBatchIndex?: number;
    batchStatus?: string;
    includeApprovalProof?: boolean;
    omitProposal?: boolean;
    proposalAwaiting?: boolean;
    affectedFiles?: string[];
    sentinelUpdatedAt?: string;
  } = {},
) {
  const stateRoot = join(root, ".codex", "pipeline");
  const sessionStore = createSessionStore(stateRoot, { strictAgents: true });
  const sentinelStore = createSentinelStateStore(stateRoot);
  const currentPhase = overrides.currentPhase ?? "phase-1";
  const pendingDecision = overrides.pendingDecision ?? "proposal-confirmation";
  const includeApprovalProof = overrides.includeApprovalProof ?? currentPhase === "phase-1.5";

  await sessionStore.save({
    sessionId: `pending-proposal-${response}`,
    runStartedAt: "2026-06-13T10:00:00.000Z",
    currentPhase,
    phase: overrides.phaseAlias ?? currentPhase,
    batchIndex: overrides.batchIndex ?? 0,
    mode: "full",
    variant: "bugfix-light",
    confidenceScore: 1,
    proposal: overrides.omitProposal
      ? undefined
      : {
          summary: "fix pending proposal answer routing",
          variant: "bugfix-light",
          awaitingUserConfirmation: overrides.proposalAwaiting ?? true,
          infoGateStatus: "passed",
          designReviewStatus: "skipped",
          planModeStatus: "skipped",
          affectedFiles: overrides.affectedFiles ?? ["src/cli/pipeline-cli.ts"],
          batchSize: 1,
          validationIntent: "standard",
        },
    unresolvedBlockers: [],
    pendingDecision,
    touchedFiles: ["src/cli/pipeline-cli.ts"],
    approvalProof: includeApprovalProof
      ? {
          kind: "controller-managed-transition",
          from: "phase-1",
          to: "phase-1.5",
        }
      : undefined,
    executionProof: currentPhase === "phase-1.5"
      ? {
          approvedScenarios: [],
          tddApproval: "REJECTED",
          redValidation: {
            status: "blocked",
            reasons: ["awaiting phase-1.5 approval"],
          },
          checkpointEvidence: [],
          fixAttempts: [],
        }
      : undefined,
  });

  await sentinelStore.save({
    pipelineActive: overrides.pipelineActive ?? true,
    currentPhase: overrides.sentinelPhase ?? currentPhase,
    currentAgent: overrides.currentAgent ?? "pipeline-controller",
    expectedNext: overrides.expectedNext ?? [currentPhase === "phase-1.5" ? "phase-1.5-response" : "proposal-response"],
    completedPhases: currentPhase === "phase-1.5" ? ["phase-0", "phase-1"] : ["phase-0"],
    gateSummary: ["INFO_GATE_OK"],
    batchState: {
      batchIndex: overrides.sentinelBatchIndex ?? overrides.batchIndex ?? 0,
      status: overrides.batchStatus
        ?? (currentPhase === "phase-1.5" ? "awaiting-plan-approval" : "awaiting-proposal-confirmation"),
    },
    consecutiveCorrections: 0,
    lastCheckpoint: currentPhase === "phase-1.5" ? "phase_0_to_1" : "post_orchestrator",
    updatedAt: overrides.sentinelUpdatedAt ?? new Date().toISOString(),
  });

  return {
    stateRoot,
    sessionStore,
  };
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

async function signSentinelState(root: string, key: string) {
  const file = join(root, ".codex", "pipeline", "sentinel-state.json");
  const state = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  const signature = createHmac("sha256", key).update(canonicalize(state)).digest("hex");
  await writeFile(
    file,
    JSON.stringify({
      ...state,
      _integrity: {
        algorithm: "hmac-sha256",
        signature,
      },
    }),
    "utf8",
  );
}

async function withSentinelHmac<T>(key: string, callback: () => Promise<T>) {
  const previous = process.env.PIPELINE_SENTINEL_HMAC_KEY;
  process.env.PIPELINE_SENTINEL_HMAC_KEY = key;
  try {
    return await callback();
  } finally {
    if (previous === undefined) {
      delete process.env.PIPELINE_SENTINEL_HMAC_KEY;
    } else {
      process.env.PIPELINE_SENTINEL_HMAC_KEY = previous;
    }
  }
}

async function withAgentRuntimeAdapter<T>(adapterPath: string, callback: () => Promise<T>) {
  const previous = process.env.CODEX_AGENT_RUNTIME_ADAPTER;
  process.env.CODEX_AGENT_RUNTIME_ADAPTER = adapterPath;
  try {
    return await callback();
  } finally {
    if (previous === undefined) {
      delete process.env.CODEX_AGENT_RUNTIME_ADAPTER;
    } else {
      process.env.CODEX_AGENT_RUNTIME_ADAPTER = previous;
    }
  }
}

async function withTempRoot<T>(callback: (root: string) => Promise<T>) {
  const root = await mkdtemp(join(tmpdir(), "pipeline-cli-test-"));
  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("pipeline CLI exit code", () => {
  it("treats every blocked status as a failed execution", () => {
    expect(resolveCliExitCode({ status: "blocked" })).toBe(1);
    expect(resolveCliExitCode({ status: "BLOCKED" })).toBe(1);
    expect(resolveCliExitCode({ status: "blocked-no-agent-runtime" })).toBe(1);
    expect(resolveCliExitCode({ status: "blocked-awaiting-parent-action" })).toBe(1);
  });

  it("keeps successful non-blocked results at exit code zero", () => {
    expect(resolveCliExitCode({ status: "phase-1" })).toBe(0);
    expect(resolveCliExitCode({ ok: true })).toBe(0);
  });

  it("blocks strict CLI execution before pretending a missing adapter can spawn agents", async () => {
    const result = await withTempRoot((root) => runPipelineCli({
      cwd: root,
      codexHome: root,
      strictAgents: true,
      task: "audit current workflow execution",
    }));

    expect(result).toMatchObject({
      status: "BLOCKED",
      reason: "blocked-no-agent-runtime",
      pipeline_valid: false,
      blockedBy: "CAPABILITY_GATE",
    });

    expect(result.missing_capabilities).toContain("spawn_agent");
    expect(resolveCliExitCode(result)).toBe(1);
  });

  it("blocks an injected adapter that cannot wait for agents or collect artifacts", async () => {
    const result = await withTempRoot((root) => runPipelineCli({
      cwd: root,
      codexHome: root,
      strictAgents: true,
      task: "audit current workflow execution",
      agentRuntime: {
        async spawnAgent(request) {
          return {
            mode: "single-agent",
            role: request.role,
            output: {
              status: "approved",
              dispatchMode: "real-agent",
            },
          };
        },
      },
    }));

    expect(result.status).toBe("BLOCKED");
    expect(result.missing_capabilities).toContain("wait_agent");
    expect(result.pipeline_valid).toBe(false);
  });

  it("uses the operational runtime when a complete agent adapter is explicitly injected", async () => {
    const result = await withTempRoot((root) => runPipelineCli({
      cwd: root,
      codexHome: root,
      strictAgents: true,
      task: "audit current workflow execution",
      agentRuntime: {
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
              status: "approved",
              dispatchMode: "real-agent",
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
    }));

    expect(result.status).not.toBe("BLOCKED");
    expect(result.proposal.awaitingUserConfirmation).toBe(true);
  });

  it.each([
    ["yes", "phase-2", "APPROVED", "phase-2-ready"],
    ["no", "phase-1", "REJECTED", "proposal-confirmation"],
    ["adjust", "phase-1", "ADJUSTED", "proposal-confirmation"],
  ])(
    "routes bare %s to the pending proposal instead of starting a new full task",
    async (response, expectedPhase, expectedStatus, expectedPendingDecision) => {
      const root = await mkdtemp(join(tmpdir(), "pipeline-cli-pending-proposal-"));

      try {
        const { sessionStore } = await seedPendingProposal(root, response);

        const result = await runPipelineCli({
          cwd: root,
          codexHome: root,
          strictAgents: true,
          task: response,
          agentRuntime: completeAgentRuntime(),
        });
        const savedSession = await sessionStore.load();

        expect(result).toMatchObject({
          phase: expectedPhase,
          confirmation: {
            kind: "PROPOSAL_CONFIRMATION",
            status: expectedStatus,
            response,
          },
        });
        expect(savedSession).toMatchObject({
          sessionId: `pending-proposal-${response}`,
          currentPhase: expectedPhase,
          pendingDecision: expectedPendingDecision,
        });
        expect(savedSession.sessionId).not.toBe(`full:${response}`);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it.each([
    ["phase-1.5-approval-required", "awaiting-plan-approval"],
    ["phase-1.5-reapproval-required", "awaiting-plan-reapproval"],
  ])("routes bare yes through the pending phase-1.5 gate for %s", async (pendingDecision, batchStatus) => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-cli-pending-plan-"));

    try {
      const { sessionStore } = await seedPendingProposal(root, "yes", {
        currentPhase: "phase-1.5",
        pendingDecision,
        batchStatus,
      });

      const result = await runPipelineCli({
        cwd: root,
        codexHome: root,
        strictAgents: true,
        task: "yes",
        agentRuntime: completeAgentRuntime(),
      });
      const savedSession = await sessionStore.load();

      expect(result).toMatchObject({
        phase: "phase-1.5",
        implementationPlan: {
          status: "APPROVED",
        },
      });
      expect(savedSession).toMatchObject({
        sessionId: "pending-proposal-yes",
        currentPhase: "phase-1.5",
      });
      expect(savedSession.pendingDecision).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["missing proposal", { omitProposal: true }],
    ["proposal not awaiting confirmation", { proposalAwaiting: false }],
    ["empty affected files", { affectedFiles: [] }],
  ])("blocks bare yes when phase-1 has %s", async (_label, overrides) => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-cli-invalid-proposal-"));

    try {
      await seedPendingProposal(root, "yes", overrides);

      const result = await runPipelineCli({
        cwd: root,
        codexHome: root,
        strictAgents: true,
        task: "yes",
        agentRuntime: completeAgentRuntime(),
      });

      expect(result).toMatchObject({
        status: "BLOCKED",
        reason: "blocked-invalid-pending-gate-state",
        blockedBy: "CLI_PENDING_GATE_STATE",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["missing proposal", { omitProposal: true }],
    ["empty affected files", { affectedFiles: [] }],
  ])("blocks bare yes when phase-1.5 has %s", async (_label, overrides) => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-cli-invalid-plan-"));

    try {
      await seedPendingProposal(root, "yes", {
        currentPhase: "phase-1.5",
        pendingDecision: "phase-1.5-approval-required",
        ...overrides,
      });

      const result = await runPipelineCli({
        cwd: root,
        codexHome: root,
        strictAgents: true,
        task: "yes",
        agentRuntime: completeAgentRuntime(),
      });

      expect(result).toMatchObject({
        status: "BLOCKED",
        reason: "blocked-invalid-pending-gate-state",
        blockedBy: "CLI_PENDING_GATE_STATE",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["inactive sentinel", { pipelineActive: false }],
    ["phase mismatch", { sentinelPhase: "phase-2" as const }],
    ["agent mismatch", { currentAgent: "executor" }],
    ["missing expected token", { expectedNext: ["continue"] }],
    ["extra expected token", { expectedNext: ["proposal-response", "continue"] }],
    ["batch index mismatch", { sentinelBatchIndex: 1 }],
    ["batch status mismatch", { batchStatus: "execution-approved" }],
  ])("blocks bare yes when pending gate state has %s", async (_label, overrides) => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-cli-invalid-gate-"));

    try {
      await seedPendingProposal(root, "yes", overrides);

      const result = await runPipelineCli({
        cwd: root,
        codexHome: root,
        strictAgents: true,
        task: "yes",
        agentRuntime: completeAgentRuntime(),
      });

      expect(result).toMatchObject({
        status: "BLOCKED",
        reason: "blocked-invalid-pending-gate-state",
        blockedBy: "CLI_PENDING_GATE_STATE",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("blocks bare yes when the pending gate sentinel is stale", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-cli-stale-gate-"));

    try {
      await seedPendingProposal(root, "yes", {
        sentinelUpdatedAt: new Date(Date.now() - 301_000).toISOString(),
      });

      const result = await runPipelineCli({
        cwd: root,
        codexHome: root,
        strictAgents: true,
        task: "yes",
        agentRuntime: completeAgentRuntime(),
      });

      expect(result).toMatchObject({
        status: "BLOCKED",
        reason: "blocked-invalid-pending-gate-state",
        blockedBy: "CLI_PENDING_GATE_STATE",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("blocks bare yes when the pending gate sentinel is future-dated", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-cli-future-gate-"));

    try {
      await seedPendingProposal(root, "yes", {
        sentinelUpdatedAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      const result = await runPipelineCli({
        cwd: root,
        codexHome: root,
        strictAgents: true,
        task: "yes",
        agentRuntime: completeAgentRuntime(),
      });

      expect(result.status).toBe("BLOCKED");
      expect(result.reason).toBe("blocked-invalid-pending-gate-state");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("blocks bare yes when sentinel HMAC is required but state is unsigned", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-cli-unsigned-sentinel-"));

    try {
      await seedPendingProposal(root, "yes");

      const result = await withSentinelHmac("test-key", () => runPipelineCli({
        cwd: root,
        codexHome: root,
        strictAgents: true,
        task: "yes",
        agentRuntime: completeAgentRuntime(),
      }));

      expect(result).toMatchObject({
        status: "BLOCKED",
        reason: "blocked-invalid-pending-gate-state",
        blockedBy: "CLI_PENDING_GATE_STATE",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("routes bare yes when sentinel HMAC is required and state is signed", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-cli-signed-sentinel-"));

    try {
      await seedPendingProposal(root, "yes");
      await signSentinelState(root, "test-key");

      const result = await withSentinelHmac("test-key", () => runPipelineCli({
        cwd: root,
        codexHome: root,
        strictAgents: true,
        task: "yes",
        agentRuntime: completeAgentRuntime(),
      }));

      expect(result).toMatchObject({
        phase: "phase-2",
        confirmation: {
          status: "APPROVED",
          response: "yes",
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("blocks bare yes when a signed sentinel is tampered", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-cli-tampered-sentinel-"));

    try {
      await seedPendingProposal(root, "yes");
      await signSentinelState(root, "test-key");

      const file = join(root, ".codex", "pipeline", "sentinel-state.json");
      const state = JSON.parse(await readFile(file, "utf8")) as {
        expectedNext: string[];
      };
      await writeFile(
        file,
        JSON.stringify({
          ...state,
          expectedNext: ["phase-2-response"],
        }),
        "utf8",
      );

      const result = await withSentinelHmac("test-key", () => runPipelineCli({
        cwd: root,
        codexHome: root,
        strictAgents: true,
        task: "yes",
        agentRuntime: completeAgentRuntime(),
      }));

      expect(result.status).toBe("BLOCKED");
      expect(result.reason).toBe("blocked-invalid-pending-gate-state");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("blocks bare yes when phase-1.5 is missing controller approval proof", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-cli-missing-proof-"));

    try {
      await seedPendingProposal(root, "yes", {
        currentPhase: "phase-1.5",
        pendingDecision: "phase-1.5-approval-required",
        includeApprovalProof: false,
      });

      const result = await runPipelineCli({
        cwd: root,
        codexHome: root,
        strictAgents: true,
        task: "yes",
        agentRuntime: completeAgentRuntime(),
      });

      expect(result).toMatchObject({
        status: "BLOCKED",
        reason: "blocked-invalid-pending-gate-state",
        blockedBy: "CLI_PENDING_GATE_STATE",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("blocks bare yes when the session phase alias conflicts with currentPhase", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-cli-phase-mismatch-"));

    try {
      await seedPendingProposal(root, "yes", {
        phaseAlias: "phase-2",
      });

      const result = await runPipelineCli({
        cwd: root,
        codexHome: root,
        strictAgents: true,
        task: "yes",
        agentRuntime: completeAgentRuntime(),
      });

      expect(result).toMatchObject({
        status: "BLOCKED",
        reason: "blocked-invalid-pending-gate-state",
        blockedBy: "CLI_PENDING_GATE_STATE",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("blocks bare yes when pending state JSON is invalid instead of starting full:yes", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-cli-corrupt-gate-"));
    const stateRoot = join(root, ".codex", "pipeline");

    try {
      await mkdir(stateRoot, { recursive: true });
      await writeFile(join(stateRoot, "session.json"), "{", "utf8");
      await writeFile(join(stateRoot, "sentinel-state.json"), "{}", "utf8");

      const result = await runPipelineCli({
        cwd: root,
        codexHome: root,
        strictAgents: true,
        task: "yes",
        agentRuntime: completeAgentRuntime(),
      });

      expect(result).toMatchObject({
        status: "BLOCKED",
        reason: "blocked-invalid-pending-gate-state",
        blockedBy: "CLI_PENDING_GATE_STATE",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("blocks invalid pending state before loading an external agent adapter", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-cli-corrupt-before-adapter-"));
    const stateRoot = join(root, ".codex", "pipeline");

    try {
      await mkdir(stateRoot, { recursive: true });
      await writeFile(join(stateRoot, "session.json"), "{", "utf8");
      await writeFile(join(stateRoot, "sentinel-state.json"), "{}", "utf8");

      const result = await withAgentRuntimeAdapter("Z:/definitely/missing/adapter.mjs", () => runPipelineCli({
        cwd: root,
        codexHome: root,
        strictAgents: true,
        task: "yes",
      }));

      expect(result).toMatchObject({
        status: "BLOCKED",
        reason: "blocked-invalid-pending-gate-state",
        blockedBy: "CLI_PENDING_GATE_STATE",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ["session only", { session: true, sentinel: false }],
    ["sentinel only", { session: false, sentinel: true }],
  ])("blocks bare yes with one-sided pending state: %s", async (_label, files) => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-cli-one-sided-state-"));
    const stateRoot = join(root, ".codex", "pipeline");

    try {
      await mkdir(stateRoot, { recursive: true });

      if (files.session) {
        const seedRoot = await mkdtemp(join(tmpdir(), "pipeline-cli-seed-session-"));
        const { sessionStore } = await seedPendingProposal(seedRoot, "yes");
        const session = await sessionStore.load();
        await writeFile(join(stateRoot, "session.json"), JSON.stringify(session), "utf8");
        await rm(seedRoot, { recursive: true, force: true });
      }

      if (files.sentinel) {
        const seedRoot = await mkdtemp(join(tmpdir(), "pipeline-cli-seed-sentinel-"));
        await seedPendingProposal(seedRoot, "yes");
        const sentinelRaw = await readFile(join(seedRoot, ".codex", "pipeline", "sentinel-state.json"), "utf8");
        await writeFile(join(stateRoot, "sentinel-state.json"), sentinelRaw, "utf8");
        await rm(seedRoot, { recursive: true, force: true });
      }

      const result = await runPipelineCli({
        cwd: root,
        codexHome: root,
        strictAgents: true,
        task: "yes",
        agentRuntime: completeAgentRuntime(),
      });

      expect(result).toMatchObject({
        status: "BLOCKED",
        reason: "blocked-invalid-pending-gate-state",
        blockedBy: "CLI_PENDING_GATE_STATE",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps bare yes as a normal CLI task when no pending state exists", async () => {
    const result = await withTempRoot((root) => runPipelineCli({
      cwd: root,
      codexHome: root,
      strictAgents: true,
      task: "yes",
      agentRuntime: completeAgentRuntime(),
    }));

    expect(result).toMatchObject({
      proposal: {
        summary: "yes",
      },
    });
  });

  it("blocks bare yes when pending state is valid JSON but invalid by schema", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-cli-invalid-schema-"));
    const stateRoot = join(root, ".codex", "pipeline");

    try {
      await mkdir(stateRoot, { recursive: true });
      await writeFile(join(stateRoot, "session.json"), JSON.stringify({ currentPhase: "phase-1" }), "utf8");
      await writeFile(join(stateRoot, "sentinel-state.json"), JSON.stringify({ pipelineActive: true }), "utf8");

      const result = await runPipelineCli({
        cwd: root,
        codexHome: root,
        strictAgents: true,
        task: "yes",
        agentRuntime: completeAgentRuntime(),
      });

      expect(result).toMatchObject({
        status: "BLOCKED",
        reason: "blocked-invalid-pending-gate-state",
        blockedBy: "CLI_PENDING_GATE_STATE",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("RED: codex-cli-process adapter is dev-bypass and cannot produce a valid pipeline", async () => {
    const result = await runPipelineCli({
      cwd: process.cwd(),
      codexHome: process.cwd(),
      strictAgents: true,
      task: "audit current workflow execution",
      agentRuntimeAdapter: "codex-cli-process",
    });

    expect(result).toMatchObject({
      status: "BLOCKED",
      pipeline_valid: false,
      runtime_mode: "dev-bypass",
    });
    expect(result.gates).toEqual([
      expect.objectContaining({
        gate: "BYPASS_MODE_ACTIVE",
        status: "BLOCKED",
      }),
    ]);
  });
});
