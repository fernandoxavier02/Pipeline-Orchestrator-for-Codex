import { detectChangedDomains, isMandatoryReviewDomain } from "../review/domain-checklists.js";
import { evaluateCheckpointValidation } from "../execution/checkpoint-validator.js";
import { derivePreTesterExecutionProof } from "../execution/pre-tester.js";
import { planQualityGateBatches } from "../execution/quality-gate-router.js";
import { runFinalValidator, runSanityChecker } from "../validation/final-validator.js";
import { reductionPolicyForMode } from "../modes/mode-policy.js";
import type { DispatchRequest, DispatchResult } from "./dispatcher-types.js";

type ReviewerFinding = {
  id: string;
  severity: "critical" | "important" | "minor";
  summary: string;
  file: string;
};

function getRequestFiles(request: DispatchRequest) {
  const inputFiles =
    Array.isArray(request.input.files)
      ? request.input.files
      : request.input.batch
        && typeof request.input.batch === "object"
        && "files" in request.input.batch
        && Array.isArray(request.input.batch.files)
          ? request.input.batch.files
          : request.input.scope
            && typeof request.input.scope === "object"
            && "files" in request.input.scope
            && Array.isArray(request.input.scope.files)
              ? request.input.scope.files
              : [];

  return inputFiles.filter((file): file is string => typeof file === "string");
}

function getChangedDomains(request: DispatchRequest, files: string[]) {
  if (Array.isArray(request.input.changedDomains)) {
    return request.input.changedDomains.filter((domain): domain is string => typeof domain === "string");
  }

  return detectChangedDomains(files);
}

function createDefaultReviewFindings(request: DispatchRequest): ReviewerFinding[] {
  if (!request.role.includes("review")) {
    return [];
  }

  const files = getRequestFiles(request);
  const changedDomains = getChangedDomains(request, files);
  const requestMode = typeof request.input.mode === "string" ? request.input.mode : undefined;
  const firstFile = files[0] ?? "unknown-file";
  const mandatoryDomains = changedDomains.filter(isMandatoryReviewDomain);
  const reductionPolicy = reductionPolicyForMode(requestMode);
  const hotfixInjectionDomains = reductionPolicy?.adversarialChecklists.includes("injection")
    ? changedDomains.filter((domain) => domain === "injection")
    : [];

  if (request.role === "batch-reviewer" && (mandatoryDomains.length > 0 || hotfixInjectionDomains.length > 0)) {
    const blockedDomains = mandatoryDomains.length > 0 ? mandatoryDomains : hotfixInjectionDomains;
    return [
      {
        id: `default-review-${blockedDomains[0]}`,
        severity: "important",
        summary: `Independent review evidence is required for ${blockedDomains.join(", ")} changes in the default runtime.`,
        file: firstFile,
      },
    ];
  }

  if (request.role === "security-reviewer") {
    const sensitiveDomains = changedDomains.filter((domain) =>
      ["auth", "crypto", "payment", "injection"].includes(domain),
    );
    if (sensitiveDomains.length > 0) {
      return [
        {
          id: `security-${sensitiveDomains[0]}`,
          severity: "important",
          summary: `Security review cannot auto-approve ${sensitiveDomains.join(", ")} changes without independent evidence.`,
          file: firstFile,
        },
      ];
    }
  }

  if (request.role === "architecture-reviewer") {
    const structuralDomains = changedDomains.filter((domain) =>
      ["data-model", "payment"].includes(domain),
    );
    if (structuralDomains.length > 0) {
      return [
        {
          id: `architecture-${structuralDomains[0]}`,
          severity: "important",
          summary: `Architecture review needs an independent challenge pass for ${structuralDomains.join(", ")} changes.`,
          file: firstFile,
        },
      ];
    }
  }

  if (request.role === "quality-reviewer" && files.length > 0) {
    return [
      {
        id: "quality-missing-proof",
        severity: "minor",
        summary: "Quality review could not verify dedicated independent regression evidence in the default runtime.",
        file: firstFile,
      },
    ];
  }

  return [];
}

function createCheckpointValidatorOutput(request: DispatchRequest) {
  const verificationEvidence =
    request.input.verificationEvidence && typeof request.input.verificationEvidence === "object"
      ? request.input.verificationEvidence as {
          requiredCheckpoints?: unknown;
          verifiedCheckpoints?: unknown;
          evidence?: unknown;
        }
      : undefined;
  const checkpointName =
    typeof request.input.checkpointName === "string" && request.input.checkpointName.length > 0
      ? request.input.checkpointName
      : "checkpoint";
  const previousFailures =
    typeof request.input.previousFailures === "number" && Number.isFinite(request.input.previousFailures)
      ? request.input.previousFailures
      : 0;
  const result = evaluateCheckpointValidation({
    verificationEvidence: verificationEvidence
      ? {
          requiredCheckpoints:
            typeof verificationEvidence.requiredCheckpoints === "number"
              ? verificationEvidence.requiredCheckpoints
              : 1,
          verifiedCheckpoints:
            typeof verificationEvidence.verifiedCheckpoints === "number"
              ? verificationEvidence.verifiedCheckpoints
              : 0,
          evidence: Array.isArray(verificationEvidence.evidence)
            ? verificationEvidence.evidence.filter((entry): entry is string => typeof entry === "string")
            : [],
        }
      : undefined,
    checkpointName,
    previousFailures,
  });
  const evidence = verificationEvidence && Array.isArray(verificationEvidence.evidence)
    ? verificationEvidence.evidence.filter((entry): entry is string => typeof entry === "string")
    : [];

  return {
    CHECKPOINT_RESULT: result.checkpointName,
    STATUS: result.status,
    EVIDENCE: evidence,
    NEXT_ACTION:
      result.status === "passed"
        ? "continue"
        : result.status === "STOP_RULE"
          ? "stop-and-analyze-root-cause"
          : "rerun-after-fix",
    status: result.status,
    checkpointName: result.checkpointName,
    consecutiveFailures: result.consecutiveFailures,
    requiredCheckpoints: result.requiredCheckpoints,
    verifiedCheckpoints: result.verifiedCheckpoints,
    coverage: result.coverage,
    evidence,
    freshContextRequired: request.freshContext ?? false,
    freshContextEmulated: request.freshContext ?? false,
    reviewOnly: request.reviewOnly ?? false,
    filesInScope: request.filesInScope ?? [],
    authorityLevel: request.authorityLevel ?? "controller",
  };
}

function createPreTesterOutput(request: DispatchRequest) {
  const approvedScenarios = Array.isArray(request.input.approvedScenarios)
    ? request.input.approvedScenarios.filter((entry): entry is string => typeof entry === "string")
    : [];
  const cwd = typeof request.input.cwd === "string" ? request.input.cwd : undefined;
  const proof = derivePreTesterExecutionProof({
    approvedScenarios,
    cwd,
  });

  return {
    PRE_TESTER_RESULT: proof.tddApproval === "APPROVED" ? "approved-proof" : "rejected-proof",
    STATUS: proof.redValidation.status,
    EVIDENCE: proof.approvedScenarios,
    NEXT_ACTION: proof.redValidation.status === "approved" ? "proceed-to-batch" : "fix-red-proof",
    approvedScenarios: proof.approvedScenarios,
    tddApproval: proof.tddApproval,
    redValidation: proof.redValidation,
    freshContextRequired: request.freshContext ?? true,
    freshContextEmulated: request.freshContext ?? true,
    reviewOnly: request.reviewOnly ?? false,
    filesInScope: request.filesInScope ?? [],
    authorityLevel: request.authorityLevel ?? "controller",
  };
}

function createQualityGateRouterOutput(request: DispatchRequest) {
  const tasks = Array.isArray(request.input.tasks)
    ? request.input.tasks.filter((entry): entry is string => typeof entry === "string")
    : [];
  const complexity =
    request.input.complexity === "SIMPLES" || request.input.complexity === "MEDIA" || request.input.complexity === "COMPLEXA"
      ? request.input.complexity
      : "MEDIA";
  const mode = typeof request.input.mode === "string" ? request.input.mode : undefined;
  const validationIntent =
    request.input.validationIntent === "standard" || request.input.validationIntent === "reduced"
      ? request.input.validationIntent
      : undefined;
  const planned = planQualityGateBatches({
    complexity,
    tasks,
    mode,
    validationIntent,
  });

  return {
    QUALITY_GATE_PLAN: "planned-batches",
    STATUS: "planned",
    EVIDENCE: planned.batches.map((batch) => `${batch.name}:${batch.tasks.join(",")}`),
    NEXT_ACTION: "proceed-to-pre-tester",
    batchSize: planned.batchSize,
    regressionProofs: planned.regressionProofs,
    approvedScenarios: planned.approvedScenarios,
    batches: planned.batches,
    freshContextRequired: request.freshContext ?? true,
    freshContextEmulated: request.freshContext ?? true,
    reviewOnly: request.reviewOnly ?? false,
    filesInScope: request.filesInScope ?? tasks,
    authorityLevel: request.authorityLevel ?? "controller",
  };
}

function createExecutorFixOutput(request: DispatchRequest) {
  const filesInScope = getRequestFiles(request);

  return {
    FIX_RESULT: "attempted",
    STATUS: "attempted",
    CHANGES: filesInScope,
    TESTS: [],
    NEXT_ACTION: "continue-fix-loop",
    status: "attempted",
    freshContextRequired: request.freshContext ?? true,
    freshContextEmulated: request.freshContext ?? true,
    reviewOnly: request.reviewOnly ?? false,
    filesInScope: request.filesInScope ?? filesInScope,
    authorityLevel: request.authorityLevel ?? "executor",
  };
}

function createSanityCheckerOutput(request: DispatchRequest) {
  const verificationEvidence = Array.isArray(request.input.verificationEvidence)
    ? request.input.verificationEvidence
      .filter((entry): entry is { kind: string; passed: boolean; label?: string } =>
        !!entry
        && typeof entry === "object"
        && typeof (entry as { kind?: unknown }).kind === "string"
        && typeof (entry as { passed?: unknown }).passed === "boolean",
      )
      .map((entry) => ({
        kind: entry.kind,
        passed: entry.passed,
        label: typeof entry.label === "string" ? entry.label : undefined,
      }))
    : [];
  const result = runSanityChecker({
    verificationEvidence,
    validationIntent: typeof request.input.validationIntent === "string" ? request.input.validationIntent : undefined,
    mode: typeof request.input.mode === "string" ? request.input.mode : undefined,
  });

  return {
    SANITY_CHECK: result.missingEvidence.length === 0 ? "final-proof-approved" : "final-proof-rejected",
    STATUS: result.status,
    EVIDENCE: result.evidence,
    NEXT_ACTION: result.nextAction,
    status: result.status,
    requiredEvidence: result.requiredEvidence,
    missingEvidence: result.missingEvidence,
    freshContextRequired: request.freshContext ?? true,
    freshContextEmulated: request.freshContext ?? true,
    reviewOnly: request.reviewOnly ?? false,
    filesInScope: request.filesInScope ?? [],
    authorityLevel: request.authorityLevel ?? "controller",
  };
}

function createFinalValidatorOutput(request: DispatchRequest) {
  const reviews = Array.isArray(request.input.reviews)
    ? request.input.reviews
      .filter((entry): entry is { status: string } =>
        !!entry && typeof entry === "object" && typeof (entry as { status?: unknown }).status === "string",
      )
      .map((entry) => ({ status: entry.status }))
    : [];
  const gateLog = Array.isArray(request.input.gateLog)
    ? request.input.gateLog
      .filter((entry): entry is {
        gate: string;
        hardness: "MANDATORY" | "HARD" | "CIRCUIT_BREAKER" | "SOFT" | "AUDIT";
        decision: "pass" | "block" | "skip" | "partial";
        phase?: string;
      } =>
        !!entry
        && typeof entry === "object"
        && typeof (entry as { gate?: unknown }).gate === "string"
        && typeof (entry as { hardness?: unknown }).hardness === "string"
        && typeof (entry as { decision?: unknown }).decision === "string",
      )
      .map((entry) => ({
        gate: entry.gate,
        hardness: entry.hardness,
        decision: entry.decision,
        phase: typeof entry.phase === "string" ? entry.phase : undefined,
      }))
    : [];
  const verificationEvidence = Array.isArray(request.input.verificationEvidence)
    ? request.input.verificationEvidence
      .filter((entry): entry is { kind: string; passed: boolean; label?: string } =>
        !!entry
        && typeof entry === "object"
        && typeof (entry as { kind?: unknown }).kind === "string"
        && typeof (entry as { passed?: unknown }).passed === "boolean",
      )
      .map((entry) => ({
        kind: entry.kind,
        passed: entry.passed,
        label: typeof entry.label === "string" ? entry.label : undefined,
      }))
    : [];
  const confidenceScore =
    typeof request.input.confidenceScore === "number" && Number.isFinite(request.input.confidenceScore)
      ? request.input.confidenceScore
      : 0;
  const result = runFinalValidator({
    reviews,
    confidenceScore,
    gateLog,
    verificationEvidence,
    validationIntent: typeof request.input.validationIntent === "string" ? request.input.validationIntent : undefined,
    mode: typeof request.input.mode === "string" ? request.input.mode : undefined,
  });

  return {
    PA_DE_CAL: "final-verdict-issued",
    DECISION: result.decision,
    BLOCKERS: [...result.blockingGates, ...result.missingEvidence],
    ROLLBACK: result.rollbackHint ?? "none",
    decision: result.decision,
    confidenceScore: result.confidenceScore,
    confidenceBand: result.confidenceBand,
    requiredEvidence: result.requiredEvidence,
    missingEvidence: result.missingEvidence,
    verificationEvidence: result.verificationEvidence,
    blockingGates: result.blockingGates,
    skippedSoftGates: result.skippedSoftGates,
    blockedReviews: result.blockedReviews,
    rollbackHint: result.rollbackHint,
    freshContextRequired: request.freshContext ?? true,
    freshContextEmulated: request.freshContext ?? true,
    reviewOnly: request.reviewOnly ?? false,
    filesInScope: request.filesInScope ?? [],
    authorityLevel: request.authorityLevel ?? "controller",
  };
}

export async function runSingleAgentRole(
  request: DispatchRequest,
): Promise<DispatchResult> {
  if (request.role === "quality-gate-router") {
    return {
      mode: "single-agent",
      role: request.role,
      output: createQualityGateRouterOutput(request),
    };
  }

  if (request.role === "pre-tester") {
    return {
      mode: "single-agent",
      role: request.role,
      output: createPreTesterOutput(request),
    };
  }

  if (request.role === "executor-fix") {
    return {
      mode: "single-agent",
      role: request.role,
      output: createExecutorFixOutput(request),
    };
  }

  if (request.role === "sanity-checker") {
    return {
      mode: "single-agent",
      role: request.role,
      output: createSanityCheckerOutput(request),
    };
  }

  if (request.role === "final-validator") {
    return {
      mode: "single-agent",
      role: request.role,
      output: createFinalValidatorOutput(request),
    };
  }

  if (request.role === "checkpoint-validator") {
    return {
      mode: "single-agent",
      role: request.role,
      output: createCheckpointValidatorOutput(request),
    };
  }

  // ── Known non-reviewer emulator roles ─────────────────────────────────────
  if (request.role === "executor-implementer") {
    const files = getRequestFiles(request);
    return {
      mode: "single-agent",
      role: request.role,
      output: {
        status: "implemented",
        // Intentionally NO changedFiles/modifiedFiles — the default runtime
        // must NOT fabricate file-change evidence. Without real agent execution,
        // the controller will block with ADVERSARIAL_SCOPE_MISSING.
        filesInScope: request.filesInScope ?? files,
        verificationEvidence: {
          requiredCheckpoints: 1,
          verifiedCheckpoints: 1,
          evidence: files.map((f) => `implemented ${f}`),
        },
      },
    };
  }

  if (request.role === "review-orchestrator") {
    return {
      mode: "single-agent",
      role: request.role,
      output: {
        status: "completed",
        reviewPlan: { batches: [] },
        filesInScope: request.filesInScope ?? [],
      },
    };
  }

  if (request.role === "executor-spec-reviewer") {
    return {
      mode: "single-agent",
      role: request.role,
      output: {
        status: "approved",
        findings: [],
        filesInScope: request.filesInScope ?? [],
      },
    };
  }

  // ── Default: reviewer roles and unknown roles ─────────────────────────────
  const freshContextRequired = request.freshContext ?? request.role.includes("review");
  const files = getRequestFiles(request);
  const findings = createDefaultReviewFindings(request);

  // Adversarial review fix: unknown non-reviewer roles default to BLOCKED.
  // Reviewer roles with no critical/important findings default to approved.
  const isReviewer = request.role.includes("review");
  const status = findings.some((finding) => finding.severity === "critical" || finding.severity === "important")
    ? "blocked"
    : isReviewer
      ? "approved"
      : "blocked";

  return {
    mode: "single-agent",
    role: request.role,
    output: {
      prompt: request.prompt,
      input: request.input,
      freshContextRequired,
      freshContextEmulated: freshContextRequired,
      contextWindow: freshContextRequired ? "fresh" : "inherited",
      reviewOnly: request.reviewOnly ?? false,
      filesInScope: request.filesInScope ?? files,
      authorityLevel: request.authorityLevel ?? "reviewer",
      findings,
      status,
      reason: isReviewer
        ? undefined
        : `Role "${request.role}" is not a registered emulator role. Defaulting to blocked.`,
    },
  };
}
