import { resumePipeline } from "../continue/resume-pipeline.js";
import { findLatestRun } from "../continue/find-latest-run.js";
import { buildProposal } from "./build-proposal.js";
import { classifyRequest } from "./classify-request.js";
import { applyClassificationOverrides } from "./classification-overrides.js";
import { confirmProposal } from "./confirm-proposal.js";
import { runDesignInterrogation } from "./design-interrogator.js";
import { getPlanModeStatus, createImplementationPlan } from "./plan-mode.js";
import { parseMode } from "./parse-mode.js";
import { runInformationGate } from "../gates/information-gate.js";
import { createConfidenceModel } from "../gates/confidence-model.js";
import { assessStaleContext } from "../gates/stale-context.js";
import { createGateRegistry } from "../gates/gate-registry.js";
import { createCheckpointStore } from "../state/checkpoint-store.js";
import { createControllerLockStore } from "../state/controller-lock.js";
import { createConfidenceScoreStore } from "../state/confidence-score.js";
import { createGateLog } from "../state/gate-log.js";
import { createSessionStore } from "../state/session-store.js";
import type { ReferenceProfileIndex } from "../references/reference-profiles.js";

type SessionStore = {
  root?: string;
  load: () => Promise<unknown>;
  save?: (session: unknown) => Promise<void>;
};

type CheckpointStore = {
  root?: string;
  list: () => Promise<Array<{ name: string; status: string }>>;
  save?: (checkpoint: unknown) => Promise<void>;
};

type GateLogStore = {
  root?: string;
  append: (decision: unknown) => Promise<void>;
  list?: () => Promise<PersistedGateLogEntry[]>;
};

type ConfidenceStore = {
  root?: string;
  save: (snapshot: unknown) => Promise<void>;
  load?: () => Promise<unknown>;
};

interface SessionProposalState {
  summary?: string;
  affectedFiles?: string[];
  planModeStatus?: string;
}

interface PipelineSessionState {
  sessionId?: string;
  currentPhase?: string;
  phase?: string;
  batchIndex?: number;
  mode?: string;
  variant?: string;
  confidenceScore?: number;
  proposal?: SessionProposalState & {
    affectedFiles?: string[];
    planModeStatus?: string;
    awaitingUserConfirmation?: boolean;
  };
  unresolvedBlockers?: string[];
  pendingDecision?: string;
  touchedFiles?: string[];
  approvalProof?: {
    kind: "controller-managed-transition";
    from: "phase-1";
    to: "phase-1.5";
  };
}

function shouldAdvanceLegacyPlanningSession(session: PipelineSessionState) {
  return session.currentPhase === "phase-1"
    && !session.proposal
    && (session.mode === "--complexa" || session.mode === "--plan");
}

function hasControllerManagedPhaseOnePointFiveTransition(session: PipelineSessionState) {
  return session.approvalProof?.kind === "controller-managed-transition"
    && session.approvalProof.from === "phase-1"
    && session.approvalProof.to === "phase-1.5";
}

function getStateRoot(runtime?: { stores?: { session?: SessionStore; checkpoints?: CheckpointStore; gateLog?: GateLogStore; confidence?: ConfidenceStore } }) {
  return runtime?.stores?.session?.root
    ?? runtime?.stores?.checkpoints?.root
    ?? runtime?.stores?.gateLog?.root
    ?? runtime?.stores?.confidence?.root;
}

type PersistedGateLogEntry = {
  gate: string;
  hardness: "MANDATORY" | "HARD" | "CIRCUIT_BREAKER" | "SOFT";
  phase: string;
  decision: "pass" | "block" | "skip" | "partial";
  decided_by: "controller" | "user" | "system" | "resume-router";
  timestamp: string;
  detail: string;
  confidence_impact: number;
};

function createRunStores(runDir: string) {
  return {
    session: createSessionStore(runDir),
    checkpoints: createCheckpointStore(runDir),
    gateLog: createGateLog(runDir),
    confidence: createConfidenceScoreStore(runDir),
  };
}

function toGateLogEntry(input: {
  gate: string;
  hardness: "MANDATORY" | "HARD" | "CIRCUIT_BREAKER" | "SOFT";
  phase: string;
  decision: "pass" | "block" | "skip" | "partial";
  detail: string;
  confidence_impact?: number;
}) {
  const registry = createGateRegistry();
  const definition = registry.get(input.gate);

  return {
    gate: input.gate,
    hardness: input.hardness ?? definition.hardness,
    phase: input.phase,
    decision: input.decision,
    decided_by: "controller" as const,
    timestamp: new Date().toISOString(),
    detail: input.detail,
    confidence_impact: input.confidence_impact ?? (input.decision === "skip" ? definition.confidenceImpactOnSkip : 0),
  } satisfies PersistedGateLogEntry;
}

function getLatestGateLogEntry(entries: PersistedGateLogEntry[]) {
  return [...entries]
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    .at(-1);
}

function isControllerRecordedGate(entry: PersistedGateLogEntry) {
  return entry.decided_by === "controller" || entry.decided_by === "resume-router";
}

function createControllerRevalidationLock(input: {
  runDir: string;
  phase: string;
  staleContext: PersistedGateLogEntry;
}) {
  return {
    kind: "controller-revalidation-lock" as const,
    runDir: input.runDir,
    phase: input.phase as "phase-0" | "phase-1" | "phase-1.5" | "phase-2" | "phase-3",
    staleContext: input.staleContext,
    updatedAt: new Date().toISOString(),
  };
}

function resolveRollbackRoute(entries: PersistedGateLogEntry[]) {
  const latest = getLatestGateLogEntry(entries);
  if (!latest) {
    return null;
  }

  const registry = createGateRegistry();
  const definition = registry.get(latest.gate);

  if (definition.rollback === "none" || latest.decision === "pass") {
    return null;
  }

  return {
    gate: latest.gate,
    decision: latest.decision,
    rollback: definition.rollback,
    detail: latest.detail,
  } as const;
}

async function resolveConfidenceBase(
  runtime: {
    stores?: {
      confidence?: ConfidenceStore;
    };
  },
  gateLogEntries: PersistedGateLogEntry[],
) {
  try {
    const persisted = await runtime?.stores?.confidence?.load?.();
    if (persisted && typeof persisted === "object" && typeof (persisted as { score?: unknown }).score === "number") {
      return (persisted as { score: number }).score;
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }

  if (gateLogEntries.length > 0) {
    return createConfidenceModel().apply({
      baseScore: 1,
      gates: gateLogEntries,
    }).score;
  }

  return 1;
}

async function persistGateAndConfidence(
  runtime: {
    stores?: {
      gateLog?: GateLogStore;
      confidence?: ConfidenceStore;
    };
  },
  entries: PersistedGateLogEntry[],
  baseScore: number,
) {
  const confidenceModel = createConfidenceModel();
  const snapshot = confidenceModel.apply({
    baseScore,
    gates: entries,
  });

  if (runtime?.stores?.gateLog) {
    for (const entry of entries) {
      await runtime.stores.gateLog.append(entry);
    }
  }

  if (runtime?.stores?.confidence) {
    await runtime.stores.confidence.save(snapshot);
  }

  return snapshot;
}

export function createPipelineController(runtime?: {
  stores?: {
    session?: SessionStore;
    checkpoints?: CheckpointStore;
    gateLog?: GateLogStore;
    confidence?: ConfidenceStore;
  };
  referenceIndex?: () => Promise<ReferenceProfileIndex>;
}) {
  return {
    async start(input: string): Promise<any> {
      const trimmedInput = input.trim();
      const normalizedResponse = trimmedInput.toLowerCase();
      const { mode, normalizedRequest } = parseMode(input);
      const stateRoot = getStateRoot(runtime);

      if (normalizedResponse === "yes" || normalizedResponse === "no" || normalizedResponse === "adjust") {
        const session = (await runtime?.stores?.session?.load?.()) as PipelineSessionState | undefined;
        const confirmation = confirmProposal(normalizedResponse);

        if (session?.currentPhase === "phase-1") {
          const planModeStatus = session.proposal?.planModeStatus;

          if (
            normalizedResponse === "yes"
            && (planModeStatus && planModeStatus !== "skipped" || shouldAdvanceLegacyPlanningSession(session))
          ) {
            await runtime?.stores?.session?.save?.({
              sessionId: session.sessionId ?? `phase-1:${session.variant ?? "proposal"}`,
              currentPhase: "phase-1.5",
              phase: "phase-1.5",
              batchIndex: session.batchIndex ?? 0,
              mode: session.mode ?? mode,
              variant: session.variant ?? "proposal",
              confidenceScore: session.confidenceScore ?? 1,
              proposal: session.proposal,
              unresolvedBlockers: session.unresolvedBlockers ?? [],
              pendingDecision: undefined,
              touchedFiles: session.touchedFiles ?? session.proposal?.affectedFiles ?? [],
              approvalProof: {
                kind: "controller-managed-transition",
                from: "phase-1",
                to: "phase-1.5",
              },
            });

            return {
              phase: "phase-1.5",
              implementationPlan: createImplementationPlan({
                status: confirmation.status,
                summary: session.proposal?.summary,
                affectedFiles: session.proposal?.affectedFiles,
              }),
            };
          }

          return {
            phase: session.currentPhase,
            confirmation,
          };
        }

        if (session?.currentPhase === "phase-1.5") {
          if (!hasControllerManagedPhaseOnePointFiveTransition(session)) {
            throw new Error("phase-1.5 session is missing controller-managed transition proof");
          }

          return {
            phase: session.currentPhase,
            implementationPlan: createImplementationPlan({
              status: confirmation.status,
              summary: session.proposal?.summary,
              affectedFiles: session.proposal?.affectedFiles,
            }),
          };
        }
      }

      if (mode === "continue") {
        if (!stateRoot) {
          const session = (await runtime?.stores?.session?.load?.()) as PipelineSessionState;
          if (!session.currentPhase) {
            throw new Error("Session is missing current phase");
          }

          if (session.currentPhase === "phase-1") {
            throw new Error("Cannot continue while proposal confirmation is pending");
          }

          if (session.currentPhase === "phase-1.5" && !hasControllerManagedPhaseOnePointFiveTransition(session)) {
            throw new Error("phase-1.5 session is missing controller-managed transition proof");
          }

          const checkpoints = await runtime?.stores?.checkpoints?.list?.() ?? [];
          return resumePipeline({
            session: {
              ...session,
              currentPhase: session.currentPhase,
            },
            checkpoints,
          });
        }

        const latestRun = await findLatestRun(stateRoot);
        const runDir = latestRun?.runDir ?? stateRoot;
        const runStores = createRunStores(runDir);
        const session = (await runStores.session.load()) as PipelineSessionState;
        const controllerLockStore = createControllerLockStore(stateRoot);
        const controllerLock = await controllerLockStore.load();

        if (!session.currentPhase) {
          throw new Error("Session is missing current phase");
        }

        if (session.currentPhase === "phase-1") {
          throw new Error("Cannot continue while proposal confirmation is pending");
        }

        if (session.currentPhase === "phase-1.5" && !hasControllerManagedPhaseOnePointFiveTransition(session)) {
          throw new Error("phase-1.5 session is missing controller-managed transition proof");
        }

        if (controllerLock) {
          const lockedRunStores = createRunStores(controllerLock.runDir);
          const lockedSession = (await lockedRunStores.session.load()) as PipelineSessionState;

          if (lockedSession.pendingDecision === "revalidate") {
            const gateLogEntries = await lockedRunStores.gateLog.list();
            return {
              mode,
              phase: lockedSession.currentPhase,
              resumeBlocked: true,
              revalidationRequired: true,
              staleContext: controllerLock.staleContext,
              latestRun: controllerLock.runDir,
              gateLogEntries,
            };
          }

          await controllerLockStore.clear();
        }

        const gateLogEntries = latestRun ? await runStores.gateLog.list() : [];
        const trustedGateLogEntries = gateLogEntries.filter(isControllerRecordedGate);
        const recordedStaleLock = trustedGateLogEntries.some((entry) => entry.gate === "STALE_CONTEXT" && entry.decision === "block");

        if (recordedStaleLock) {
          return {
            mode,
            phase: session.currentPhase,
            resumeBlocked: true,
            revalidationRequired: true,
            staleContext: getLatestGateLogEntry(trustedGateLogEntries),
            latestRun: runDir,
            gateLogEntries,
          };
        }

        const lastActivityAt = latestRun?.lastActivityAt ?? new Date().toISOString();
        const confidenceBase = await resolveConfidenceBase({ stores: runStores }, trustedGateLogEntries);
        const staleContext = assessStaleContext({
          session,
          lastActivityAt,
          now: new Date(),
        });

        if (staleContext) {
          await persistGateAndConfidence(
            { stores: runStores },
            [staleContext],
            confidenceBase,
          );

          await runStores.session.save({
            ...session,
            currentPhase: session.currentPhase,
            phase: session.phase ?? session.currentPhase,
            unresolvedBlockers: [...new Set([...(session.unresolvedBlockers ?? []), staleContext.detail])],
            pendingDecision: "revalidate",
            touchedFiles: session.touchedFiles ?? session.proposal?.affectedFiles ?? [],
          });

          await controllerLockStore.save(createControllerRevalidationLock({
            runDir,
            phase: session.currentPhase,
            staleContext,
          }));

          return {
            mode,
            phase: session.currentPhase,
            resumeBlocked: true,
            staleContext,
            latestRun: runDir,
            gateLogEntries,
          };
        }

        const rollbackRoute = resolveRollbackRoute(trustedGateLogEntries);
        if (rollbackRoute) {
          await runStores.session.save({
            ...session,
            currentPhase: session.currentPhase,
            phase: session.phase ?? session.currentPhase,
            unresolvedBlockers: [...new Set([...(session.unresolvedBlockers ?? []), rollbackRoute.detail])],
            pendingDecision: rollbackRoute.rollback,
            touchedFiles: session.touchedFiles ?? session.proposal?.affectedFiles ?? [],
          });

          return {
            mode,
            phase: session.currentPhase,
            resumeBlocked: true,
            revalidationRequired: rollbackRoute.rollback === "revalidate",
            rollbackGate: rollbackRoute.gate,
            rollbackRoute: rollbackRoute.rollback,
            rollbackDecision: rollbackRoute.decision,
            latestRun: runDir,
            gateLogEntries,
          };
        }

        const checkpoints = await runStores.checkpoints.list();
        return resumePipeline({
          session: {
            ...session,
            currentPhase: session.currentPhase,
          },
          checkpoints,
        });
      }

      const referenceIndex = await runtime?.referenceIndex?.();
      const baseClassification = classifyRequest(normalizedRequest, referenceIndex);
      const classificationResult = applyClassificationOverrides(mode, baseClassification, referenceIndex);
      const infoGate = runInformationGate({
        request: normalizedRequest,
        classification: classificationResult.classification,
        knownFacts: [],
        referenceIndex,
      });
      const designInterrogation = runDesignInterrogation({
        mode,
        request: normalizedRequest,
        complexity: classificationResult.classification.complexity,
      });
      const planModeStatus = getPlanModeStatus(mode, classificationResult.classification.complexity);
      const proposal = buildProposal({
        request: normalizedRequest,
        classification: classificationResult.classification,
        infoGateStatus: infoGate.status,
        designReviewStatus: designInterrogation.status,
        planModeStatus,
        batchSize: classificationResult.profile.batchSize,
        validationIntent: classificationResult.validationIntent,
      });

      const gateEntries = [
        toGateLogEntry({
          gate: infoGate.gate,
          hardness: infoGate.hardness,
          phase: "phase-0",
          decision: infoGate.status === "passed" ? "pass" : infoGate.status === "partial" ? "partial" : "block",
          detail: infoGate.reason,
        }),
        toGateLogEntry({
          gate: "DESIGN_INTERROGATION",
          hardness: "SOFT",
          phase: "phase-0",
          decision: designInterrogation.status === "passed"
            ? "pass"
            : designInterrogation.status === "partial"
              ? "partial"
              : "skip",
          detail: designInterrogation.summary,
        }),
      ];

      await persistGateAndConfidence(
        runtime ?? {},
        gateEntries,
        1,
      );

      if (mode === "diagnostic") {
        return {
          mode,
          type: classificationResult.classification.type,
          complexity: classificationResult.classification.complexity,
          variant: classificationResult.classification.variant,
          proposal,
          gates: [infoGate, designInterrogation],
          stoppedAfterProposal: true,
        };
      }

      if (mode === "review-only") {
        return {
          mode,
          type: classificationResult.classification.type,
          complexity: classificationResult.classification.complexity,
          variant: classificationResult.classification.variant,
          proposal,
          gates: [infoGate, designInterrogation],
          implementationSkipped: true,
        };
      }

      await runtime?.stores?.session?.save?.({
        sessionId: `${mode}:${normalizedRequest || "request"}`,
        currentPhase: "phase-1",
        phase: "phase-1",
        batchIndex: 0,
        mode,
        variant: classificationResult.classification.variant,
        confidenceScore: 1,
        proposal: {
          ...proposal,
          awaitingUserConfirmation: true,
        },
        unresolvedBlockers: infoGate.status === "blocked" ? [infoGate.reason] : [],
        pendingDecision: "proposal-confirmation",
        touchedFiles: proposal.affectedFiles,
      });

      return {
        mode,
        type: classificationResult.classification.type,
        complexity: classificationResult.classification.complexity,
        variant: classificationResult.classification.variant,
        proposal,
        gates: [infoGate, designInterrogation],
        planModeStatus,
      };
    },
  };
}
