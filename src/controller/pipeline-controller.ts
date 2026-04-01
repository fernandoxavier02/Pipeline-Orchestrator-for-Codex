import { resumePipeline } from "../continue/resume-pipeline.js";
import { buildProposal } from "./build-proposal.js";
import { classifyRequest } from "./classify-request.js";
import { applyClassificationOverrides } from "./classification-overrides.js";
import { confirmProposal } from "./confirm-proposal.js";
import { runDesignInterrogation } from "./design-interrogator.js";
import { getPlanModeStatus, createImplementationPlan } from "./plan-mode.js";
import { parseMode } from "./parse-mode.js";
import { runInformationGate } from "../gates/information-gate.js";
import type { ReferenceProfileIndex } from "../references/reference-profiles.js";

interface SessionProposalState {
  summary?: string;
  affectedFiles?: string[];
  planModeStatus?: string;
}

interface PipelineSessionState {
  sessionId?: string;
  currentPhase?: string;
  mode?: string;
  variant?: string;
  confidenceScore?: number;
  proposal?: SessionProposalState;
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

export function createPipelineController(runtime?: {
  stores?: {
    session: { load: () => Promise<unknown>; save?: (session: unknown) => Promise<void> };
    checkpoints: { list: () => Promise<Array<{ name: string; status: string }>> };
  };
  referenceIndex?: () => Promise<ReferenceProfileIndex>;
}) {
  return {
    async start(input: string): Promise<any> {
      const trimmedInput = input.trim();
      const normalizedResponse = trimmedInput.toLowerCase();
      const { mode, normalizedRequest } = parseMode(input);

      if (normalizedResponse === "yes" || normalizedResponse === "no" || normalizedResponse === "adjust") {
        const session = (await runtime?.stores?.session.load?.()) as PipelineSessionState | undefined;
        const confirmation = confirmProposal(normalizedResponse);

        if (session?.currentPhase === "phase-1") {
          const planModeStatus = session.proposal?.planModeStatus;

          if (
            normalizedResponse === "yes"
            && (planModeStatus && planModeStatus !== "skipped" || shouldAdvanceLegacyPlanningSession(session))
          ) {
            await runtime?.stores?.session.save?.({
              sessionId: session.sessionId ?? `phase-1:${session.variant ?? "proposal"}`,
              currentPhase: "phase-1.5",
              mode: session.mode ?? mode,
              variant: session.variant ?? "proposal",
              confidenceScore: session.confidenceScore ?? 1,
              proposal: session.proposal,
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
        const session = (await runtime?.stores?.session.load?.()) as PipelineSessionState;

        if (!session.currentPhase) {
          throw new Error("Session is missing current phase");
        }

        if (session.currentPhase === "phase-1") {
          throw new Error("Cannot continue while proposal confirmation is pending");
        }

        if (session.currentPhase === "phase-1.5" && !hasControllerManagedPhaseOnePointFiveTransition(session)) {
          throw new Error("phase-1.5 session is missing controller-managed transition proof");
        }

        const resumableSession = {
          ...session,
          currentPhase: session.currentPhase,
        };

        const checkpoints = (await runtime?.stores?.checkpoints.list?.()) as Array<{
          name: string;
          status: string;
        }>;

        return resumePipeline({
          session: resumableSession,
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

      await runtime?.stores?.session.save?.({
        sessionId: `${mode}:${normalizedRequest || "request"}`,
        currentPhase: "phase-1",
        mode,
        variant: classificationResult.classification.variant,
        confidenceScore: 1,
        proposal,
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
