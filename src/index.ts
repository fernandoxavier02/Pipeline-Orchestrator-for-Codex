import { fileURLToPath } from "node:url";
import { loadPipelineConfig } from "./config/load-pipeline-config.js";
import { renderCloseout } from "./closeout/render-closeout.js";
import { createPipelineController } from "./controller/pipeline-controller.js";
import { findLatestRun } from "./continue/find-latest-run.js";
import type { DispatchRequest } from "./dispatcher/dispatcher-types.js";
import { runRole } from "./dispatcher/run-role.js";
import { PIPELINE_MODES, type RuntimeOptions } from "./domain/pipeline-types.js";
import { createExecutorController } from "./execution/executor-controller.js";
import { createConfidenceModel } from "./gates/confidence-model.js";
import { createGateRegistry } from "./gates/gate-registry.js";
import { createPromptRegistry } from "./prompts/prompt-registry.js";
import { loadReferenceBundle } from "./references/load-reference-bundle.js";
import { createReferenceProfileIndex } from "./references/reference-profiles.js";
import { runAdversarialReview } from "./review/adversarial-review.js";
import { createReviewOrchestrator } from "./review/review-orchestrator.js";
import { createCheckpointStore } from "./state/checkpoint-store.js";
import { createConfidenceScoreStore } from "./state/confidence-score.js";
import { createGateLog } from "./state/gate-log.js";
import { createSessionStore } from "./state/session-store.js";
import { resolveEffectiveGateLog, runFinalValidator } from "./validation/final-validator.js";

type CloseoutGateEntry = {
  gate: string;
  hardness: "MANDATORY" | "HARD" | "CIRCUIT_BREAKER" | "SOFT";
  phase: string;
  decision: "pass" | "block" | "skip" | "partial";
  decided_by: "controller";
  timestamp: string;
  detail: string;
  confidence_impact: number;
};

type CloseoutSessionState = {
  runStartedAt?: string;
  closeout?: {
    decision: "GO" | "CONDITIONAL" | "NO-GO";
    missingEvidence: string[];
    blockingGates: string[];
    skippedSoftGates: string[];
    blockedReviews: number;
    rollbackHint?: string | null;
    verificationEvidence: Array<{
      kind: string;
      passed: boolean;
      label?: string;
    }>;
    updatedAt: string;
  };
  executionProof?: {
    checkpointEvidence?: Array<{
      batchName: string;
      requiredCheckpoints: number;
      verifiedCheckpoints: number;
      evidence: string[];
    }>;
  };
};

function hasControllerCheckpointProof(input: {
  batchName: string;
  checkpointEvidence: Array<{
    batchName: string;
    requiredCheckpoints: number;
    verifiedCheckpoints: number;
    evidence: string[];
  }>;
}) {
  return input.checkpointEvidence.some((entry) =>
    entry.batchName === input.batchName
    && entry.evidence.length > 0
    && entry.verifiedCheckpoints >= entry.requiredCheckpoints,
  );
}

function resolveAuthoritativeEvidenceKinds(input: {
  batches: Array<{ name: string }>;
  session?: CloseoutSessionState;
  gateLog: Array<{ gate: string; decision: string; decided_by?: string }>;
  mode?: string;
  validationIntent?: string;
}) {
  const checkpointEvidence = input.session?.executionProof?.checkpointEvidence ?? [];
  const evidenceKinds = new Set<string>();
  const hasControllerBatchProof = input.batches.length > 0
    && input.batches.every((batch) => hasControllerCheckpointProof({
      batchName: batch.name,
      checkpointEvidence,
    }));

  if (hasControllerBatchProof) {
    evidenceKinds.add("build");
    evidenceKinds.add("tests");
  }

  const requiresReducedValidation = input.mode === "--hotfix" || input.validationIntent === "reduced";
  const finalReviewRecorded = input.gateLog.some(
    (entry) => entry.gate === "FINAL_ADVERSARIAL_GATE"
      && entry.decision === "pass"
      && entry.decided_by === "controller",
  );

  if (!requiresReducedValidation && finalReviewRecorded) {
    evidenceKinds.add("final-review");
  }

  return evidenceKinds;
}

function resolveCloseoutScopeStartedAt(input: {
  batches: Array<{ name: string }>;
  checkpoints: Array<{ name: string; status?: string; timestamp?: string }>;
  session?: CloseoutSessionState;
}) {
  const runStartedAt = input.session?.runStartedAt;
  if (runStartedAt) {
    const runStartedAtMs = Date.parse(runStartedAt);
    if (!Number.isNaN(runStartedAtMs)) {
      return runStartedAt;
    }
  }

  const activeBatchNames = new Set(input.batches.map((batch) => batch.name));
  const latestCheckpointTimes = new Map<string, number>();

  for (const checkpoint of input.checkpoints) {
    if (!activeBatchNames.has(checkpoint.name) || checkpoint.status !== "completed" || !checkpoint.timestamp) {
      continue;
    }

    const checkpointTimeMs = Date.parse(checkpoint.timestamp);
    if (Number.isNaN(checkpointTimeMs)) {
      continue;
    }

    const latestForBatch = latestCheckpointTimes.get(checkpoint.name) ?? Number.NEGATIVE_INFINITY;
    if (checkpointTimeMs > latestForBatch) {
      latestCheckpointTimes.set(checkpoint.name, checkpointTimeMs);
    }
  }

  if (latestCheckpointTimes.size === 0) {
    return undefined;
  }

  return new Date(Math.min(...latestCheckpointTimes.values())).toISOString();
}

function filterCloseoutGateLogForSession<T extends { timestamp?: string }>(input: {
  gateLog: T[];
  scopeStartedAt?: string;
}): T[] {
  if (!input.scopeStartedAt) {
    return input.gateLog;
  }

  const runStartedAtMs = Date.parse(input.scopeStartedAt);
  if (Number.isNaN(runStartedAtMs)) {
    return input.gateLog;
  }

  return input.gateLog.filter((entry) => {
    if (!entry.timestamp) {
      return false;
    }

    const entryTimeMs = Date.parse(entry.timestamp);
    return !Number.isNaN(entryTimeMs) && entryTimeMs >= runStartedAtMs;
  });
}

function resolveRuntimePromptName(role: string) {
  if (role === "executor-implementer") {
    return "executor/executor-implementer";
  }

  if (role === "batch-reviewer") {
    return "quality/adversarial-reviewer";
  }

  if (role === "information-gate") {
    return "core/information-gate";
  }

  return undefined;
}

async function loadCloseoutSession(input: {
  load?: () => Promise<unknown>;
}) {
  if (!input.load) {
    return undefined;
  }

  try {
    return await input.load() as CloseoutSessionState;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

export function createPipelineRuntime(options: RuntimeOptions) {
  const config = loadPipelineConfig(options.cwd);
  const bundledPromptRoot = fileURLToPath(new URL("../", import.meta.url));
  const stateDir = `${options.cwd}/.codex/pipeline`;
  const sessionStore = createSessionStore(stateDir);
  const checkpointStore = createCheckpointStore(stateDir);
  const gateLogStore = createGateLog(stateDir);
  const confidenceStore = createConfidenceScoreStore(stateDir);
  const promptRegistry = createPromptRegistry(options.cwd, {
    fallbackRoots: [bundledPromptRoot],
  });
  const controllerStores = {
    session: sessionStore,
    checkpoints: checkpointStore,
    gateLog: gateLogStore,
    confidence: confidenceStore,
  };
  const publicStores = {
    session: {
      load: sessionStore.load,
    },
    checkpoints: {
      list: checkpointStore.list,
    },
  };
  const getReferenceIndex = (() => {
    let referenceIndexPromise: Promise<ReturnType<typeof createReferenceProfileIndex>> | undefined;

    return () => {
      referenceIndexPromise ??= loadReferenceBundle(options.cwd).then(createReferenceProfileIndex);
      return referenceIndexPromise;
    };
  })();
  const runtimeRunRole = async (request: DispatchRequest) => {
    const promptName = resolveRuntimePromptName(request.role);
    const prompt = promptName
      ? [
          await promptRegistry.load(promptName),
          request.prompt,
        ].filter((part) => part.length > 0).join("\n\n")
      : request.prompt;

    return runRole({
      ...request,
      prompt,
    });
  };
  const runtimeReviewOrchestrator = createReviewOrchestrator({
    runRole: runtimeRunRole,
  });
  const runtimeExecutionController = createExecutorController({
    runRole: runtimeRunRole,
    adversarialReview: (input) => runAdversarialReview({
      ...input,
      reviewOrchestrator: runtimeReviewOrchestrator,
    }),
  });
  const baseController = createPipelineController({
    workspaceRoot: options.cwd,
    stores: controllerStores,
    referenceIndex: getReferenceIndex,
    executionController: runtimeExecutionController,
    reviewOrchestrator: runtimeReviewOrchestrator,
  });

  const ensureRuntimePrompts = async () => {
    await promptRegistry.preload([
      "controller/pipeline-controller",
      "core/information-gate",
    ]);
  };

  const confidenceModel = createConfidenceModel();
  const gateRegistry = createGateRegistry();

  async function resolveCloseoutStores() {
    let latestRun;
    try {
      latestRun = await findLatestRun(stateDir);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
    const runDir = latestRun?.runDir ?? stateDir;

    return {
      runDir,
      session: createSessionStore(runDir),
      checkpoints: createCheckpointStore(runDir),
      gateLog: createGateLog(runDir),
      confidence: createConfidenceScoreStore(runDir),
    };
  }

  function getEvidenceLabel(input: { kind: string; label?: string }) {
    if (input.label) {
      return input.label;
    }

    if (input.kind === "build") {
      return config.buildCommand;
    }

    if (input.kind === "tests") {
      return config.testCommand;
    }

    if (input.kind === "final-review") {
      return "final adversarial review";
    }

    return input.kind;
  }

  return {
    controller: {
      async start(input: string) {
        await ensureRuntimePrompts();
        return baseController.start(input);
      },
    },
    closeout: {
      async finalize(input: {
        reviews: Array<{ status: string }>;
        batches: Array<{ name: string }>;
        verificationEvidence: Array<{ kind: string; passed: boolean; label?: string }>;
        confirmed: boolean;
        mode?: string;
        validationIntent?: string;
      }) {
        const closeoutStores = await resolveCloseoutStores();
        const checkpoints = await closeoutStores.checkpoints.list();
        const existingGateLog = await closeoutStores.gateLog.list();
        const session = await loadCloseoutSession({
          load: closeoutStores.session.load,
        });
        const appendedEntries: CloseoutGateEntry[] = [
          {
            gate: "CLOSEOUT_CONFIRM",
            hardness: gateRegistry.get("CLOSEOUT_CONFIRM").hardness,
            phase: "phase-3",
            decision: input.confirmed ? "pass" : "skip",
            decided_by: "controller" as const,
            timestamp: new Date().toISOString(),
            detail: input.confirmed
              ? "Operator explicitly confirmed closeout."
              : "Operator closeout confirmation was skipped.",
            confidence_impact: input.confirmed ? 0 : gateRegistry.get("CLOSEOUT_CONFIRM").confidenceImpactOnSkip,
          },
        ];

        if (input.mode === "--hotfix" || input.validationIntent === "reduced") {
          appendedEntries.push({
            gate: "REDUCED_VALIDATION_USAGE",
            hardness: gateRegistry.get("REDUCED_VALIDATION_USAGE").hardness,
            phase: "phase-3",
            decision: "pass",
            decided_by: "controller" as const,
            timestamp: new Date().toISOString(),
            detail: "Hotfix closeout used reduced final validation (build plus tests).",
            confidence_impact: 0,
          });
        }

        for (const entry of appendedEntries) {
          await closeoutStores.gateLog.append(entry);
        }

        const scopeStartedAt = resolveCloseoutScopeStartedAt({
          batches: input.batches,
          checkpoints,
          session,
        });
        const scopedExistingGateLog = filterCloseoutGateLogForSession({
          gateLog: existingGateLog,
          scopeStartedAt,
        });
        const effectiveGateLog = resolveEffectiveGateLog([
          ...scopedExistingGateLog,
          ...appendedEntries,
        ]);
        const nextConfidence = confidenceModel.apply({
          baseScore: 1,
          gates: effectiveGateLog.map((entry) => ({
            gate: entry.gate,
            hardness: entry.hardness,
            phase: entry.phase ?? "phase-3",
            decision: entry.decision,
            decided_by: entry.decided_by ?? "controller",
            timestamp: entry.timestamp ?? new Date().toISOString(),
            detail: entry.detail ?? "",
            confidence_impact: entry.confidence_impact ?? 0,
          })),
        });
        await closeoutStores.confidence.save(nextConfidence);

        const authoritativeEvidenceKinds = resolveAuthoritativeEvidenceKinds({
          batches: input.batches,
          session,
          gateLog: effectiveGateLog,
          mode: input.mode,
          validationIntent: input.validationIntent,
        });
        const verificationEvidence = input.verificationEvidence.map((evidence) => ({
          ...evidence,
          label: getEvidenceLabel(evidence),
          passed: evidence.passed && authoritativeEvidenceKinds.has(evidence.kind),
        }));
        const gateLog: Array<{
          gate: string;
          hardness: "MANDATORY" | "HARD" | "CIRCUIT_BREAKER" | "SOFT";
          decision: "pass" | "block" | "skip" | "partial";
          phase?: string;
        }> = effectiveGateLog;
        const validation = runFinalValidator({
          reviews: input.reviews,
          confidenceScore: nextConfidence.score,
          gateLog,
          verificationEvidence,
          validationIntent: input.validationIntent,
          mode: input.mode,
        });
        if (session) {
          await closeoutStores.session.save({
            ...session,
            closeout: {
              decision: validation.decision,
              missingEvidence: validation.missingEvidence,
              blockingGates: validation.blockingGates,
              skippedSoftGates: validation.skippedSoftGates,
              blockedReviews: validation.blockedReviews,
              rollbackHint: validation.rollbackHint,
              verificationEvidence,
              updatedAt: new Date().toISOString(),
            },
          });
        }
        const text = renderCloseout({
          ...validation,
          batches: input.batches,
          validationIntent: input.validationIntent,
        });

        return {
          ...validation,
          text,
        };
      },
    },
    dispatcher: { runRole: runtimeRunRole },
    config,
    promptRegistry,
    stateDir,
    supportedModes: [...PIPELINE_MODES],
    referenceIndex: getReferenceIndex,
    stores: publicStores,
  };
}
