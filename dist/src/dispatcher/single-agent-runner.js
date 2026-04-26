import { detectChangedDomains, isMandatoryReviewDomain } from "../review/domain-checklists.js";
import { evaluateCheckpointValidation } from "../execution/checkpoint-validator.js";
import { derivePreTesterExecutionProof } from "../execution/pre-tester.js";
import { planQualityGateBatches } from "../execution/quality-gate-router.js";
import { runFinalValidator, runSanityChecker } from "../validation/final-validator.js";
import { reductionPolicyForMode } from "../modes/mode-policy.js";
function getRequestFiles(request) {
    const inputFiles = Array.isArray(request.input.files)
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
    return inputFiles.filter((file) => typeof file === "string");
}
function getChangedDomains(request, files) {
    if (Array.isArray(request.input.changedDomains)) {
        return request.input.changedDomains.filter((domain) => typeof domain === "string");
    }
    return detectChangedDomains(files);
}
function createDefaultReviewFindings(request) {
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
        const sensitiveDomains = changedDomains.filter((domain) => ["auth", "crypto", "payment", "injection"].includes(domain));
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
        const structuralDomains = changedDomains.filter((domain) => ["data-model", "payment"].includes(domain));
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
function createCheckpointValidatorOutput(request) {
    const verificationEvidence = request.input.verificationEvidence && typeof request.input.verificationEvidence === "object"
        ? request.input.verificationEvidence
        : undefined;
    const checkpointName = typeof request.input.checkpointName === "string" && request.input.checkpointName.length > 0
        ? request.input.checkpointName
        : "checkpoint";
    const previousFailures = typeof request.input.previousFailures === "number" && Number.isFinite(request.input.previousFailures)
        ? request.input.previousFailures
        : 0;
    const result = evaluateCheckpointValidation({
        verificationEvidence: verificationEvidence
            ? {
                requiredCheckpoints: typeof verificationEvidence.requiredCheckpoints === "number"
                    ? verificationEvidence.requiredCheckpoints
                    : 1,
                verifiedCheckpoints: typeof verificationEvidence.verifiedCheckpoints === "number"
                    ? verificationEvidence.verifiedCheckpoints
                    : 0,
                evidence: Array.isArray(verificationEvidence.evidence)
                    ? verificationEvidence.evidence.filter((entry) => typeof entry === "string")
                    : [],
            }
            : undefined,
        checkpointName,
        previousFailures,
    });
    const evidence = verificationEvidence && Array.isArray(verificationEvidence.evidence)
        ? verificationEvidence.evidence.filter((entry) => typeof entry === "string")
        : [];
    return {
        CHECKPOINT_RESULT: result.checkpointName,
        STATUS: result.status,
        EVIDENCE: evidence,
        NEXT_ACTION: result.status === "passed"
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
function createPreTesterOutput(request) {
    const approvedScenarios = Array.isArray(request.input.approvedScenarios)
        ? request.input.approvedScenarios.filter((entry) => typeof entry === "string")
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
function createQualityGateRouterOutput(request) {
    const tasks = Array.isArray(request.input.tasks)
        ? request.input.tasks.filter((entry) => typeof entry === "string")
        : [];
    const complexity = request.input.complexity === "SIMPLES" || request.input.complexity === "MEDIA" || request.input.complexity === "COMPLEXA"
        ? request.input.complexity
        : "MEDIA";
    const mode = typeof request.input.mode === "string" ? request.input.mode : undefined;
    const validationIntent = request.input.validationIntent === "standard" || request.input.validationIntent === "reduced"
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
function createExecutorFixOutput(request) {
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
function createSanityCheckerOutput(request) {
    const verificationEvidence = Array.isArray(request.input.verificationEvidence)
        ? request.input.verificationEvidence
            .filter((entry) => !!entry
            && typeof entry === "object"
            && typeof entry.kind === "string"
            && typeof entry.passed === "boolean")
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
function createFinalValidatorOutput(request) {
    const reviews = Array.isArray(request.input.reviews)
        ? request.input.reviews
            .filter((entry) => !!entry && typeof entry === "object" && typeof entry.status === "string")
            .map((entry) => ({ status: entry.status }))
        : [];
    const gateLog = Array.isArray(request.input.gateLog)
        ? request.input.gateLog
            .filter((entry) => !!entry
            && typeof entry === "object"
            && typeof entry.gate === "string"
            && typeof entry.hardness === "string"
            && typeof entry.decision === "string")
            .map((entry) => ({
            gate: entry.gate,
            hardness: entry.hardness,
            decision: entry.decision,
            phase: typeof entry.phase === "string" ? entry.phase : undefined,
        }))
        : [];
    const verificationEvidence = Array.isArray(request.input.verificationEvidence)
        ? request.input.verificationEvidence
            .filter((entry) => !!entry
            && typeof entry === "object"
            && typeof entry.kind === "string"
            && typeof entry.passed === "boolean")
            .map((entry) => ({
            kind: entry.kind,
            passed: entry.passed,
            label: typeof entry.label === "string" ? entry.label : undefined,
        }))
        : [];
    const confidenceScore = typeof request.input.confidenceScore === "number" && Number.isFinite(request.input.confidenceScore)
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
export async function runSingleAgentRole(request) {
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
    const freshContextRequired = request.freshContext ?? request.role.includes("review");
    const files = getRequestFiles(request);
    const findings = createDefaultReviewFindings(request);
    const status = findings.some((finding) => finding.severity === "critical" || finding.severity === "important")
        ? "blocked"
        : "approved";
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
        },
    };
}
