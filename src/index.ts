import { fileURLToPath } from "node:url";
import { loadPipelineConfig } from "./config/load-pipeline-config.js";
import { renderCloseout } from "./closeout/render-closeout.js";
import { createPipelineController } from "./controller/pipeline-controller.js";
import { runRole } from "./dispatcher/run-role.js";
import { PIPELINE_MODES, type RuntimeOptions } from "./domain/pipeline-types.js";
import { createConfidenceModel } from "./gates/confidence-model.js";
import { createGateRegistry } from "./gates/gate-registry.js";
import { createPromptRegistry } from "./prompts/prompt-registry.js";
import { loadReferenceBundle } from "./references/load-reference-bundle.js";
import { createReferenceProfileIndex } from "./references/reference-profiles.js";
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
  gateLog: Array<{ gate: string; decision: string }>;
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
    (entry) => entry.gate === "FINAL_ADVERSARIAL_GATE" && entry.decision === "pass",
  );

  if (!requiresReducedValidation && finalReviewRecorded) {
    evidenceKinds.add("final-review");
  }

  return evidenceKinds;
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
  const baseController = createPipelineController({
    workspaceRoot: options.cwd,
    stores: controllerStores,
    referenceIndex: getReferenceIndex,
  });

  const ensureControllerPrompt = async () => {
    await promptRegistry.load("controller/pipeline-controller");
  };

  const confidenceModel = createConfidenceModel();
  const gateRegistry = createGateRegistry();

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
        await ensureControllerPrompt();
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
        const existingGateLog = await gateLogStore.list();
        const session = await loadCloseoutSession({
          load: sessionStore.load,
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
          await gateLogStore.append(entry);
        }

        const effectiveGateLog = resolveEffectiveGateLog([
          ...existingGateLog,
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
        await confidenceStore.save(nextConfidence);

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
    dispatcher: { runRole },
    config,
    promptRegistry,
    stateDir,
    supportedModes: [...PIPELINE_MODES],
    referenceIndex: getReferenceIndex,
    stores: publicStores,
  };
}
