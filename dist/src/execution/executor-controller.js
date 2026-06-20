import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runAdversarialReview } from "../review/adversarial-review.js";
import { createFinalAdversarialOrchestrator } from "../review/final-adversarial-orchestrator.js";
import { createReviewOrchestrator } from "../review/review-orchestrator.js";
import { detectChangedDomains } from "../review/domain-checklists.js";
import { runRole } from "../dispatcher/run-role.js";
import { createCheckpointValidator } from "./checkpoint-validator.js";
import { createPreTester } from "./pre-tester.js";
import { createQualityGateRouter } from "./quality-gate-router.js";
import { resolveExecutionComplexity } from "../modes/complexity-resolution.js";
import { reductionPolicyForMode } from "../modes/mode-policy.js";
const authoritativeFinalReviewResultSymbol = Symbol("authoritative-final-review-result");
const DEFAULT_FIX_LOOP_MAX_ATTEMPTS = 3;
const DIFF_DISCIPLINE_FIX_LOOP_MAX_ATTEMPTS = 5;
function normalizeFiles(files) {
    if (!Array.isArray(files)) {
        return [];
    }
    return files
        .filter((file) => typeof file === "string" && file.length > 0)
        .map((file) => file.replace(/\\/g, "/"))
        .filter((file, index, values) => values.indexOf(file) === index);
}
function extractExecutionChangedFiles(payload) {
    if (!payload || typeof payload !== "object") {
        return [];
    }
    const candidateKeys = ["changedFiles", "modifiedFiles", "touchedFiles", "affectedFiles", "files"];
    for (const key of candidateKeys) {
        if (key in payload) {
            const files = normalizeFiles(payload[key]);
            if (files.length > 0) {
                return files;
            }
        }
    }
    if ("output" in payload && payload.output && typeof payload.output === "object") {
        return extractExecutionChangedFiles(payload.output);
    }
    return [];
}
function createMissingChangedFilesReview(batch) {
    return {
        batch: batch.name,
        files: [],
        changedDomains: [],
        checklists: [],
        required: true,
        gate: "ADVERSARIAL_SCOPE_MISSING",
        decision: "block",
        status: "blocked",
        findings: [
            {
                severity: "important",
                summary: `Executor changed-file evidence is required before adversarial review can validate ${batch.name}.`,
                file: batch.files[0] ?? "unknown-file",
            },
        ],
        strategy: "missing-changed-file-evidence",
    };
}
function summarizeEffectiveReview(review) {
    if (!review || typeof review !== "object") {
        return {
            status: "approved",
            findings: [],
        };
    }
    const candidate = review;
    return {
        status: typeof candidate.status === "string" ? candidate.status : "approved",
        findings: Array.isArray(candidate.findings)
            ? candidate.findings
            : [],
    };
}
function resolveReworkFindings(review) {
    if (!review || typeof review !== "object") {
        return undefined;
    }
    const candidate = review;
    const directReviewerFindings = Array.isArray(candidate.reviews)
        ? candidate.reviews
            .filter((entry) => !!entry && typeof entry === "object")
            .filter((entry) => typeof entry.reviewer === "string"
            && ["batch-reviewer", "executor-spec-reviewer", "quality-reviewer", "diff-discipline-reviewer"].includes(entry.reviewer))
            .flatMap((entry) => Array.isArray(entry.findings)
            ? entry.findings.filter((finding) => !!finding && typeof finding === "object")
            : [])
        : [];
    if (directReviewerFindings.length > 0) {
        return directReviewerFindings;
    }
    return Array.isArray(candidate.findings)
        ? candidate.findings.filter((finding) => !!finding && typeof finding === "object")
        : undefined;
}
function isDiffDisciplineReviewBlocked(review) {
    if (!review || typeof review !== "object") {
        return false;
    }
    const candidate = review;
    const blockedReviewer = Array.isArray(candidate.reviews)
        ? candidate.reviews.some((entry) => !!entry
            && typeof entry === "object"
            && entry.reviewer === "diff-discipline-reviewer"
            && entry.status === "blocked")
        : false;
    if (blockedReviewer) {
        return true;
    }
    return Array.isArray(candidate.findings)
        && candidate.findings.some((finding) => !!finding
            && typeof finding === "object"
            && finding.source === "diff-discipline");
}
function isCheckpointStatus(value) {
    return value === "passed" || value === "failed" || value === "STOP_RULE";
}
function parseCheckpointValidationResult(output) {
    if (!output || typeof output !== "object") {
        return undefined;
    }
    const candidate = output;
    const status = candidate.status ?? candidate.STATUS;
    const checkpointName = candidate.checkpointName ?? candidate.CHECKPOINT_RESULT;
    if (!isCheckpointStatus(status)
        || typeof checkpointName !== "string"
        || typeof candidate.consecutiveFailures !== "number"
        || typeof candidate.requiredCheckpoints !== "number"
        || typeof candidate.verifiedCheckpoints !== "number"
        || typeof candidate.coverage !== "number") {
        return undefined;
    }
    return {
        status,
        checkpointName,
        consecutiveFailures: candidate.consecutiveFailures,
        requiredCheckpoints: candidate.requiredCheckpoints,
        verifiedCheckpoints: candidate.verifiedCheckpoints,
        coverage: candidate.coverage,
    };
}
function isPreTesterStatus(value) {
    return value === "approved" || value === "blocked";
}
function isTddApproval(value) {
    return value === "APPROVED" || value === "REJECTED";
}
function parsePreTesterProof(output) {
    if (!output || typeof output !== "object") {
        return undefined;
    }
    const candidate = output;
    const approvedScenarios = Array.isArray(candidate.approvedScenarios)
        ? candidate.approvedScenarios.filter((entry) => typeof entry === "string")
        : undefined;
    const tddApproval = candidate.tddApproval;
    const redValidation = candidate.redValidation;
    const redValidationRecord = redValidation && typeof redValidation === "object"
        ? redValidation
        : undefined;
    const reasons = Array.isArray(redValidationRecord?.reasons)
        ? redValidationRecord.reasons.filter((entry) => typeof entry === "string")
        : undefined;
    if (!approvedScenarios
        || !isTddApproval(tddApproval)
        || !redValidationRecord
        || !isPreTesterStatus(redValidationRecord.status)
        || !reasons) {
        return undefined;
    }
    return {
        approvedScenarios,
        tddApproval,
        redValidation: {
            status: redValidationRecord.status,
            reasons,
        },
    };
}
function parseQualityGatePlan(output) {
    if (!output || typeof output !== "object") {
        return undefined;
    }
    const candidate = output;
    const batchSize = candidate.batchSize;
    const regressionProofs = candidate.regressionProofs;
    const approvedScenarios = Array.isArray(candidate.approvedScenarios)
        ? candidate.approvedScenarios.filter((entry) => typeof entry === "string")
        : undefined;
    const batches = Array.isArray(candidate.batches)
        ? candidate.batches
            .filter((entry) => !!entry
            && typeof entry === "object"
            && typeof entry.name === "string"
            && Array.isArray(entry.tasks)
            && entry.tasks.every((task) => typeof task === "string"))
            .map((entry) => {
            const plannedBatch = entry;
            return {
                name: plannedBatch.name,
                tasks: plannedBatch.tasks,
                parallel_eligible: typeof plannedBatch.parallel_eligible === "boolean"
                    ? plannedBatch.parallel_eligible
                    : undefined,
                parallel_reason: typeof plannedBatch.parallel_reason === "string"
                    ? plannedBatch.parallel_reason
                    : undefined,
            };
        })
        : undefined;
    if (typeof batchSize !== "number"
        || typeof regressionProofs !== "number"
        || !approvedScenarios
        || !batches) {
        return undefined;
    }
    return {
        batchSize,
        regressionProofs,
        approvedScenarios,
        batches,
    };
}
function parseExecutorFixResult(output) {
    if (!output || typeof output !== "object") {
        return undefined;
    }
    const candidate = output;
    const status = candidate.status ?? candidate.FIX_RESULT;
    if (typeof status !== "string" || status.length === 0) {
        return undefined;
    }
    return {
        status,
        success: status === "fixed",
    };
}
function resolveBatchParallelMetadata(batch) {
    if (typeof batch.parallel_eligible === "boolean") {
        return {
            parallel_eligible: batch.parallel_eligible,
            parallel_execution_actual: false,
            execution_mode: batch.parallel_eligible ? "parallel-eligible-serial-runtime" : "serial",
            fallback_reason: batch.parallel_eligible
                ? "Runtime preserved serial execution while exposing parallel eligibility for parent dispatchers."
                : batch.parallel_reason ?? "Batch is not parallel eligible.",
            warning: undefined,
        };
    }
    return {
        parallel_eligible: undefined,
        parallel_execution_actual: false,
        execution_mode: "serial-fallback",
        fallback_reason: "parallel_eligible absent or undefined; executor used serial fallback observably.",
        warning: "WARN parallel_eligible absent; serial fallback used.",
    };
}
function buildBatchTaskProjection(input) {
    const failed = input.checkpoint.status !== "passed";
    return input.batch.tasks.map((task, index) => ({
        task_id: task || `${input.batch.name}:task-${index + 1}`,
        status: failed ? "BATCH_FAIL" : "BATCH_PASS",
        first_failure: failed && index === 0
            ? input.checkpoint.status
            : null,
        attribution: "batch_projection",
    }));
}
function normalizeContractPath(path) {
    return path.replace(/\\/g, "/");
}
function validateBatchAgainstChangeContract(input) {
    if (!input.changeContract) {
        return { ok: true };
    }
    const allowed = new Set([
        ...input.changeContract.allowed_files,
        ...input.changeContract.allowed_new_files,
    ].map(normalizeContractPath));
    const forbidden = new Set(input.changeContract.forbidden_files.map(normalizeContractPath));
    const files = input.batch.tasks.map(normalizeContractPath);
    const forbiddenTouched = files.filter((file) => forbidden.has(file));
    const outsideAllowed = files.filter((file) => !allowed.has(file));
    if (forbiddenTouched.length > 0 || outsideAllowed.length > 0) {
        return {
            ok: false,
            forbiddenTouched,
            outsideAllowed,
        };
    }
    return { ok: true };
}
function withActiveChangeContract(input) {
    if (!input.sessionRoot || !input.changeContract) {
        return input.action();
    }
    const contractPath = join(input.sessionRoot, "change-contract.json");
    mkdirSync(input.sessionRoot, { recursive: true });
    writeFileSync(contractPath, JSON.stringify(input.changeContract), "utf8");
    return input.action().finally(() => {
        try {
            unlinkSync(contractPath);
        }
        catch {
            // Best-effort cleanup: a blocked attempt may already have removed it.
        }
    });
}
async function defaultRunBatch(batch, dependencies) {
    const executeRole = dependencies?.runRole ?? runRole;
    const adversarialReview = dependencies?.adversarialReview ?? runAdversarialReview;
    const execution = await executeRole({
        mode: "single-agent",
        role: "executor-implementer",
        prompt: "Implement only the current batch.",
        input: { batch, changeContract: batch.changeContract },
        sessionRoot: dependencies?.sessionRoot,
        sessionId: dependencies?.sessionId,
    });
    const changedFiles = extractExecutionChangedFiles(execution) ?? [];
    if (changedFiles.length === 0) {
        return {
            execution,
            review: createMissingChangedFilesReview(batch),
            changedFiles: [],
            verificationEvidence: execution.output
                && typeof execution.output === "object"
                && "verificationEvidence" in execution.output
                ? execution.output.verificationEvidence
                : undefined,
        };
    }
    const review = await adversarialReview({
        batch,
        changedFiles,
        mode: dependencies?.mode,
    });
    return {
        execution,
        review,
        changedFiles,
        verificationEvidence: execution.output
            && typeof execution.output === "object"
            && "verificationEvidence" in execution.output
            ? execution.output.verificationEvidence
            : undefined,
    };
}
function toExecutionBatch(batch, changeContract) {
    return {
        name: batch.name,
        files: [...("tasks" in batch ? batch.tasks : batch.files)],
        changeContract: "changeContract" in batch ? batch.changeContract : changeContract,
    };
}
function toPlannedBatch(batch) {
    return {
        name: batch.name,
        tasks: [...("tasks" in batch ? batch.tasks : batch.files)],
    };
}
function normalizeScenarioPath(path) {
    return path.replace(/\\/g, "/");
}
function createBatchReviewLoopContext(iteration, maxIterations = DEFAULT_FIX_LOOP_MAX_ATTEMPTS) {
    return {
        iteration,
        maxIterations,
        afterFix: iteration > 0,
    };
}
function mergeVerificationEvidence(input) {
    const approvedScenarios = new Set(input.approvedScenarios.map(normalizeScenarioPath));
    const fixOutput = input.fixDispatch
        && typeof input.fixDispatch === "object"
        && "output" in input.fixDispatch
        && input.fixDispatch.output
        && typeof input.fixDispatch.output === "object"
        ? input.fixDispatch.output
        : undefined;
    const fixTests = [
        ...(Array.isArray(fixOutput?.TESTS) ? fixOutput.TESTS : []),
        ...(Array.isArray(fixOutput?.tests) ? fixOutput.tests : []),
    ]
        .filter((entry) => typeof entry === "string")
        .map(normalizeScenarioPath)
        .filter((entry, index, values) => values.indexOf(entry) === index)
        .filter((entry) => approvedScenarios.has(entry));
    const evidence = [
        ...input.base.evidence.map(normalizeScenarioPath),
        ...fixTests,
    ].filter((entry, index, values) => values.indexOf(entry) === index);
    return {
        requiredCheckpoints: input.base.requiredCheckpoints,
        verifiedCheckpoints: Math.min(evidence.length, input.base.requiredCheckpoints),
        evidence,
    };
}
function deriveControllerVerificationEvidence(input) {
    const approvedScenarios = new Set(input.approvedScenarios.map(normalizeScenarioPath));
    const rawEvidence = input.batchResult && typeof input.batchResult === "object" && "verificationEvidence" in input.batchResult
        ? input.batchResult.verificationEvidence
        : undefined;
    const candidateScenarios = [
        ...(rawEvidence?.scenarios ?? []),
        ...(rawEvidence?.evidence ?? []),
    ]
        .map(normalizeScenarioPath)
        .filter((scenario, index, scenarios) => scenarios.indexOf(scenario) === index);
    const verifiedScenarios = candidateScenarios.filter((scenario) => approvedScenarios.has(scenario));
    const requiredCheckpoints = Math.max(1, Math.min(input.regressionProofs, approvedScenarios.size || 1));
    return {
        requiredCheckpoints,
        verifiedCheckpoints: Math.min(verifiedScenarios.length, requiredCheckpoints),
        evidence: verifiedScenarios,
    };
}
export function markAuthoritativeFinalReviewResult(result) {
    Object.defineProperty(result, authoritativeFinalReviewResultSymbol, {
        value: true,
        enumerable: false,
    });
    return result;
}
export function hasAuthoritativeFinalReviewResult(result) {
    return !!result && typeof result === "object" && authoritativeFinalReviewResultSymbol in result;
}
function reviewPassed(review) {
    if (!review || typeof review !== "object" || !("status" in review))
        return false;
    const status = review.status;
    return typeof status === "string"
        && ["approved", "pass", "passed", "clean"].includes(status.toLowerCase());
}
function reviewOpenFindings(review) {
    if (review && typeof review === "object" && "findings" in review && Array.isArray(review.findings)) {
        return (review.findings).length;
    }
    if (reviewPassed(review))
        return 0;
    return 1;
}
async function recordBatchLoopEvidence(input) {
    if (!input.gateLog?.append)
        return;
    const phase = input.phase ?? "phase-2";
    const timestamp = new Date().toISOString();
    const steps = [
        {
            step: "checkpoint",
            pass: input.checkpoint.status === "passed",
            detail: input.checkpoint.status === "passed"
                ? "Batch checkpoint passed."
                : "Batch checkpoint did not pass.",
        },
        {
            step: "adversarial_review",
            pass: reviewPassed(input.batchReview),
            detail: reviewPassed(input.batchReview)
                ? "Batch adversarial review passed."
                : "Batch adversarial review blocked.",
        },
        {
            step: "fix_loop",
            pass: input.openFindings === 0 && input.attempts <= DEFAULT_FIX_LOOP_MAX_ATTEMPTS,
            detail: "Batch fix loop closed with no open findings.",
            open_findings: input.openFindings,
            attempts: input.attempts,
        },
    ];
    for (const step of steps) {
        await input.gateLog.append({
            gate: `BATCH_LOOP:${input.batchName}:${step.step}`,
            hardness: "MANDATORY",
            phase,
            decision: step.pass ? "pass" : "block",
            provenance: { source: "controller" },
            timestamp,
            detail: step.detail,
            confidence_impact: step.pass ? 0 : -0.2,
            evidence_ref: `batch:${input.batchName}:${step.step}`,
            ...("open_findings" in step ? { open_findings: step.open_findings } : {}),
            ...("attempts" in step ? { attempts: step.attempts } : {}),
        });
    }
}
async function dispatchExecutorFix(input) {
    if (!input.runRole) {
        return undefined;
    }
    return input.runRole({
        mode: "single-agent",
        role: "executor-fix",
        prompt: "Apply the current finding set from fresh context within the approved batch scope.",
        input: {
            batch: {
                name: input.batch.name,
                files: [...input.batch.files],
            },
            files: [...input.batch.files],
            changedDomains: [...(input.changedDomains ?? [])],
            findings: input.findings,
            attempt: input.attempt,
            strategy: input.strategy,
        },
        filesInScope: [...input.batch.files],
        authorityLevel: "executor",
        freshContext: true,
        reviewOnly: false,
        sessionRoot: input.sessionRoot,
        sessionId: input.sessionId,
    });
}
async function resolveCheckpointValidation(input) {
    if (!input.runRole) {
        return input.checkpointValidator.validateCheckpoints({
            verificationEvidence: input.verificationEvidence,
            checkpointName: input.checkpointName,
        });
    }
    const dispatch = await input.runRole({
        mode: "single-agent",
        role: "checkpoint-validator",
        prompt: "Validate proportional per-batch evidence before the checkpoint can pass.",
        input: {
            verificationEvidence: input.verificationEvidence,
            checkpointName: input.checkpointName,
            previousFailures: input.previousFailures,
        },
        filesInScope: [...input.batch.files],
        authorityLevel: "controller",
        freshContext: true,
        reviewOnly: false,
    });
    const parsed = parseCheckpointValidationResult(dispatch.output);
    if (!parsed) {
        throw new Error("checkpoint-validator returned an invalid runtime result");
    }
    return parsed;
}
async function resolvePreTesterProof(input) {
    if (!input.runRole) {
        return input.preTester.deriveExecutionProof({
            approvedScenarios: input.approvedScenarios,
            cwd: input.cwd,
        });
    }
    const dispatch = await input.runRole({
        mode: "single-agent",
        role: "pre-tester",
        prompt: "Validate TDD proof and RED readiness before any implementation batch proceeds.",
        input: {
            approvedScenarios: input.approvedScenarios,
            cwd: input.cwd,
        },
        filesInScope: [...input.filesInScope],
        authorityLevel: "controller",
        freshContext: true,
        reviewOnly: false,
    });
    const parsed = parsePreTesterProof(dispatch.output);
    if (!parsed) {
        throw new Error("pre-tester returned an invalid runtime result");
    }
    return parsed;
}
async function resolveQualityGatePlan(input) {
    if (!input.runRole) {
        return input.qualityGateRouter.planBatches({
            complexity: input.complexity,
            tasks: input.tasks,
            mode: input.mode,
            validationIntent: input.validationIntent,
        });
    }
    const dispatch = await input.runRole({
        mode: "single-agent",
        role: "quality-gate-router",
        prompt: "Plan proportional Phase 2 batches and regression proof depth from the approved task set.",
        input: {
            complexity: input.complexity,
            tasks: input.tasks,
            mode: input.mode,
            validationIntent: input.validationIntent,
        },
        filesInScope: [...input.tasks],
        authorityLevel: "controller",
        freshContext: true,
        reviewOnly: false,
    });
    const parsed = parseQualityGatePlan(dispatch.output);
    if (!parsed) {
        throw new Error("quality-gate-router returned an invalid runtime result");
    }
    return parsed;
}
function isAuditReportOnlyVariant(variant) {
    return typeof variant === "string" && variant.startsWith("audit-");
}
async function executeAuditReportOnly(input) {
    const auditTasks = input.tasks.length > 0 ? input.tasks : ["audit-report-scope"];
    const agents = [
        {
            role: "audit-intake",
            expectedOutput: ["AUDIT_INTAKE_RESULT", "AuditIntake"],
            prompt: "Perform read-only audit intake. Inventory the requested scope and return evidence-based findings only.",
        },
        {
            role: "audit-domain-analyzer",
            expectedOutput: ["DOMAIN_ANALYSIS", "DependencyImpactAudit", "DecisionSSOTAudit", "ContractGovernanceAudit"],
            prompt: "Perform read-only architecture, domain, SSOT, and contract analysis for the audit scope.",
        },
        {
            role: "audit-compliance-checker",
            expectedOutput: ["COMPLIANCE_REPORT", "DataGovernanceAudit", "FrontendDeepAudit", "BackendDeepAudit", "DeliveryGovernanceAudit"],
            prompt: "Perform read-only data, security, frontend, backend, test, and governance compliance review.",
        },
        {
            role: "audit-risk-matrix-generator",
            expectedOutput: ["AUDIT_REPORT", "AuditMasterSeal"],
            prompt: "Consolidate read-only audit findings into a risk matrix with severity, evidence, and recommendations.",
        },
    ];
    const reports = [];
    for (const agent of agents) {
        if (!input.runRole) {
            reports.push({
                role: agent.role,
                output: {
                    status: "completed",
                    summary: "Local report-only audit role completed without runtime dispatch.",
                    evidence: auditTasks,
                },
            });
            continue;
        }
        reports.push(await input.runRole({
            mode: "single-agent",
            role: agent.role,
            phase: "phase-2",
            prompt: agent.prompt,
            input: {
                audit_request: input.summary ?? "",
                scope: auditTasks,
                variant: input.variant,
                report_only: true,
            },
            expectedOutput: agent.expectedOutput,
            filesInScope: auditTasks,
            authorityLevel: "reviewer",
            freshContext: true,
            reviewOnly: true,
            sessionRoot: input.sessionRoot,
            sessionId: input.sessionId,
        }));
    }
    return markAuthoritativeFinalReviewResult({
        status: "completed",
        execution: {
            mode: "report-only",
            variant: input.variant,
            reports: reports.map((report) => ({
                role: report.role,
                output: report.output,
            })),
        },
        changedFiles: [],
        review: {
            status: "approved",
            mode: "report-only",
            reports: reports.map((report) => report.role),
        },
        finalReview: {
            status: "approved",
            finalDecision: "approved",
            mode: "report-only-audit",
        },
        verificationEvidence: {
            scenarios: auditTasks,
            evidence: auditTasks,
        },
        proof: {
            approvedScenarios: auditTasks,
            tddApproval: "APPROVED",
            redValidation: {
                status: "approved",
                reasons: ["Report-only audit uses evidence-first validation instead of TDD."],
            },
            checkpointEvidence: [{
                    batchName: "audit-report-only",
                    requiredCheckpoints: 1,
                    verifiedCheckpoints: 1,
                    evidence: auditTasks,
                }],
            fixAttempts: [],
        },
    });
}
export function createExecutorController(dependencies = {}) {
    let currentExecutionMode;
    let currentSessionRoot;
    let currentSessionId;
    const runBatch = dependencies.runBatch ?? ((batch) => defaultRunBatch(batch, {
        runRole: dependencies.runRole,
        adversarialReview: dependencies.adversarialReview,
        mode: currentExecutionMode,
        sessionRoot: currentSessionRoot,
        sessionId: currentSessionId,
    }));
    const qualityGateRouter = dependencies.qualityGateRouter ?? createQualityGateRouter();
    const preTester = dependencies.preTester ?? createPreTester();
    const finalAdversarialOrchestrator = dependencies.finalAdversarialOrchestrator
        ?? ((input) => createFinalAdversarialOrchestrator().reviewFinal(input));
    const reviewOrchestrator = dependencies.reviewOrchestrator
        ?? createReviewOrchestrator({
            runRole: dependencies.runRole,
        });
    const runFixLoop = async (input) => {
        let strategy = input.strategy;
        const maxAttempts = input.maxAttempts ?? DEFAULT_FIX_LOOP_MAX_ATTEMPTS;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            const success = await input.attemptFix({ attempt, strategy });
            if (success) {
                return {
                    status: "FIXED",
                    attempts: attempt,
                    strategy,
                };
            }
            if (attempt === 2) {
                strategy = "strategy-change-required";
            }
        }
        return {
            status: "FIX_LOOP_EXHAUSTED",
            attempts: maxAttempts,
            strategyChangeRequired: true,
        };
    };
    return {
        async executeApprovedWork(input) {
            currentExecutionMode = input.mode;
            currentSessionRoot = input.sessionRoot;
            currentSessionId = input.sessionId;
            const checkpointValidator = dependencies.checkpointValidator ?? createCheckpointValidator();
            checkpointValidator.reset?.();
            const tasks = input.batch?.files ?? input.tasks ?? input.proposal?.affectedFiles ?? [];
            const complexity = resolveExecutionComplexity({
                mode: input.mode,
                complexity: input.complexity,
                variant: input.variant,
            });
            if (isAuditReportOnlyVariant(input.variant)) {
                return executeAuditReportOnly({
                    runRole: dependencies.runRole,
                    summary: input.proposal?.summary,
                    tasks,
                    variant: input.variant,
                    sessionRoot: input.sessionRoot,
                    sessionId: input.sessionId,
                });
            }
            const batchPolicy = reductionPolicyForMode(input.mode);
            const planned = input.batch
                ? {
                    batchSize: input.batch.files.length || 1,
                    regressionProofs: batchPolicy
                        ? batchPolicy.tdd.minimumTests
                        : input.proposal?.validationIntent === "reduced"
                            ? 1
                            : 2,
                    approvedScenarios: [...(input.approvedScenarios ?? [])],
                    batches: [toPlannedBatch(input.batch)],
                }
                : await resolveQualityGatePlan({
                    runRole: dependencies.runRole,
                    qualityGateRouter,
                    complexity,
                    tasks,
                    mode: input.mode,
                    validationIntent: input.proposal?.validationIntent,
                });
            const proof = await resolvePreTesterProof({
                runRole: dependencies.runRole,
                preTester,
                filesInScope: input.batch?.files ?? tasks,
                approvedScenarios: input.approvedScenarios ?? [],
                cwd: input.workingDirectory,
            });
            const changeContract = input.changeContract ?? input.proposal?.CHANGE_CONTRACT;
            const batchMetadata = planned.batches.map((batch) => ({
                batch: batch.name,
                tasks: [...batch.tasks],
                ...resolveBatchParallelMetadata(batch),
            }));
            if (proof.tddApproval !== "APPROVED") {
                return {
                    status: "blocked",
                    blockedBy: "TDD_APPROVAL",
                    planned,
                    proof: {
                        ...proof,
                        checkpointEvidence: [],
                        fixAttempts: [],
                    },
                };
            }
            if (proof.redValidation.status === "blocked") {
                return {
                    status: "blocked",
                    blockedBy: "RED_VALIDATION",
                    reasons: proof.redValidation.reasons,
                    planned,
                    proof: {
                        ...proof,
                        checkpointEvidence: [],
                        fixAttempts: [],
                    },
                };
            }
            const batchResults = [];
            const checkpointEvidence = [];
            const appliedFixAttempts = [];
            let checkpointFailureCount = 0;
            for (const [index, batch] of planned.batches.entries()) {
                const scopeValidation = validateBatchAgainstChangeContract({ batch, changeContract });
                if (!scopeValidation.ok) {
                    return {
                        status: "blocked",
                        blockedBy: "CHANGE_CONTRACT_SCOPE",
                        batchSize: planned.batchSize,
                        regressionProofs: planned.regressionProofs,
                        planned,
                        violation: scopeValidation,
                        proof: {
                            ...proof,
                            checkpointEvidence,
                            fixAttempts: appliedFixAttempts,
                        },
                        batches: planned.batches,
                        results: batchResults,
                    };
                }
                const executionBatch = toExecutionBatch(batch, changeContract);
                const batchResult = await withActiveChangeContract({
                    sessionRoot: currentSessionRoot,
                    changeContract,
                    action: () => runBatch(executionBatch),
                });
                const actualChangedFiles = extractExecutionChangedFiles(batchResult);
                const verificationEvidence = deriveControllerVerificationEvidence({
                    approvedScenarios: proof.approvedScenarios,
                    regressionProofs: planned.regressionProofs,
                    batchResult,
                });
                const batchFixAttempts = batchResult && typeof batchResult === "object" && "fixAttempts" in batchResult && Array.isArray(batchResult.fixAttempts)
                    ? batchResult.fixAttempts
                    : [];
                const checkpoint = await resolveCheckpointValidation({
                    runRole: dependencies.runRole,
                    checkpointValidator,
                    batch: executionBatch,
                    verificationEvidence,
                    checkpointName: batch.name,
                    previousFailures: checkpointFailureCount,
                });
                checkpointFailureCount = checkpoint.status === "passed" ? 0 : checkpoint.consecutiveFailures;
                const changedDomains = detectChangedDomains(actualChangedFiles.length > 0 ? actualChangedFiles : executionBatch.files);
                const currentBatchResult = {
                    batch,
                    changedFiles: actualChangedFiles,
                    execution: batchResult.execution && typeof batchResult.execution === "object"
                        ? batchResult.execution
                        : {},
                    review: batchResult.review,
                    batchReview: undefined,
                    checkpoint,
                };
                let activeCheckpoint = checkpoint;
                const parallelMetadata = resolveBatchParallelMetadata(batch);
                let activeBatchReview = await reviewOrchestrator.reviewBatch({
                    batch: {
                        name: batch.name,
                        files: actualChangedFiles.length > 0 ? actualChangedFiles : executionBatch.files,
                    },
                    changedFiles: actualChangedFiles,
                    changedDomains,
                    mode: input.mode,
                    changeContract,
                    reviewLoop: createBatchReviewLoopContext(0),
                });
                const batchFixAttemptStart = appliedFixAttempts.length;
                checkpointEvidence.push({
                    batchName: batch.name,
                    requiredCheckpoints: checkpoint.requiredCheckpoints,
                    verifiedCheckpoints: checkpoint.verifiedCheckpoints,
                    evidence: verificationEvidence?.evidence ?? [],
                    parallel_eligible: parallelMetadata.parallel_eligible,
                    parallel_execution: parallelMetadata.parallel_execution_actual,
                    parallel_execution_actual: parallelMetadata.parallel_execution_actual,
                    execution_mode: parallelMetadata.execution_mode,
                    per_task_status: [],
                    batch_task_projection: buildBatchTaskProjection({
                        batch,
                        checkpoint,
                    }),
                });
                currentBatchResult.batchReview = activeBatchReview;
                if (actualChangedFiles.length === 0) {
                    const missingEvidenceReview = createMissingChangedFilesReview(executionBatch);
                    currentBatchResult.changedFiles = [];
                    currentBatchResult.review = missingEvidenceReview;
                    currentBatchResult.batchReview = activeBatchReview;
                    currentBatchResult.checkpoint = activeCheckpoint;
                    batchResults.push(currentBatchResult);
                    return {
                        status: "blocked",
                        blockedBy: "ADVERSARIAL_SCOPE_MISSING",
                        batchSize: planned.batchSize,
                        regressionProofs: planned.regressionProofs,
                        execution: batchResult.execution,
                        review: missingEvidenceReview,
                        validation: checkpoint,
                        proof: {
                            ...proof,
                            checkpointEvidence,
                            fixAttempts: appliedFixAttempts,
                        },
                        batches: planned.batches,
                        results: batchResults,
                    };
                }
                batchResults.push(currentBatchResult);
                if (batchResult.review
                    && typeof batchResult.review === "object"
                    && "status" in batchResult.review
                    && batchResult.review.status === "blocked") {
                    return {
                        status: "blocked",
                        blockedBy: "ADVERSARIAL_BLOCK",
                        batchSize: planned.batchSize,
                        regressionProofs: planned.regressionProofs,
                        execution: batchResult.execution,
                        review: batchResult.review,
                        validation: checkpoint,
                        proof: {
                            ...proof,
                            checkpointEvidence,
                            fixAttempts: appliedFixAttempts,
                        },
                        batches: planned.batches,
                        results: batchResults,
                    };
                }
                await input.stores?.checkpoints?.save?.({
                    name: batch.name,
                    phase: input.phase ?? "phase-2",
                    batchIndex: index,
                    status: checkpoint.status === "passed" ? "completed" : "failed",
                    timestamp: new Date().toISOString(),
                    detail: checkpoint.status === "passed"
                        ? "Checkpoint verified proportionally"
                        : checkpoint.status === "STOP_RULE"
                            ? "Checkpoint validation exhausted the stop rule"
                            : "Checkpoint validation failed",
                    parallel_eligible: parallelMetadata.parallel_eligible,
                    parallel_execution: parallelMetadata.parallel_execution_actual,
                    parallel_execution_actual: parallelMetadata.parallel_execution_actual,
                    execution_mode: parallelMetadata.execution_mode,
                    per_task_status: [],
                    batch_task_projection: buildBatchTaskProjection({
                        batch,
                        checkpoint,
                    }),
                });
                if (!reviewPassed(activeBatchReview)) {
                    if (dependencies.runRole || batchFixAttempts.length > 0) {
                        const isDiffDisciplineRework = isDiffDisciplineReviewBlocked(activeBatchReview);
                        const reviewLoopMaxAttempts = isDiffDisciplineRework
                            ? DIFF_DISCIPLINE_FIX_LOOP_MAX_ATTEMPTS
                            : DEFAULT_FIX_LOOP_MAX_ATTEMPTS;
                        const fixLoopResult = await runFixLoop({
                            strategy: isDiffDisciplineRework ? "diff-discipline-rework" : "independent-review-rework",
                            maxAttempts: reviewLoopMaxAttempts,
                            attemptFix: async ({ attempt, strategy }) => {
                                const fixDispatch = await withActiveChangeContract({
                                    sessionRoot: currentSessionRoot,
                                    changeContract,
                                    action: () => dispatchExecutorFix({
                                        runRole: dependencies.runRole,
                                        batch: executionBatch,
                                        attempt,
                                        strategy,
                                        findings: resolveReworkFindings(activeBatchReview),
                                        changedDomains,
                                        sessionRoot: currentSessionRoot,
                                        sessionId: currentSessionId,
                                    }),
                                });
                                const structuredResult = parseExecutorFixResult(fixDispatch && typeof fixDispatch === "object" && "output" in fixDispatch
                                    ? fixDispatch.output
                                    : undefined);
                                const fixApplied = structuredResult?.success ?? (batchFixAttempts[attempt - 1] ?? false);
                                appliedFixAttempts.push(fixApplied);
                                if (!fixApplied) {
                                    return false;
                                }
                                const loopVerificationEvidence = mergeVerificationEvidence({
                                    base: verificationEvidence,
                                    fixDispatch,
                                    approvedScenarios: proof.approvedScenarios,
                                });
                                activeCheckpoint = await resolveCheckpointValidation({
                                    runRole: dependencies.runRole,
                                    checkpointValidator,
                                    batch: executionBatch,
                                    verificationEvidence: loopVerificationEvidence,
                                    checkpointName: batch.name,
                                    previousFailures: checkpointFailureCount,
                                });
                                checkpointFailureCount = activeCheckpoint.status === "passed"
                                    ? 0
                                    : activeCheckpoint.consecutiveFailures;
                                checkpointEvidence[checkpointEvidence.length - 1] = {
                                    batchName: batch.name,
                                    requiredCheckpoints: activeCheckpoint.requiredCheckpoints,
                                    verifiedCheckpoints: activeCheckpoint.verifiedCheckpoints,
                                    evidence: loopVerificationEvidence.evidence,
                                    parallel_eligible: parallelMetadata.parallel_eligible,
                                    parallel_execution: parallelMetadata.parallel_execution_actual,
                                    parallel_execution_actual: parallelMetadata.parallel_execution_actual,
                                    execution_mode: parallelMetadata.execution_mode,
                                    per_task_status: [],
                                    batch_task_projection: buildBatchTaskProjection({
                                        batch,
                                        checkpoint: activeCheckpoint,
                                    }),
                                };
                                currentBatchResult.checkpoint = activeCheckpoint;
                                if (activeCheckpoint.status !== "passed") {
                                    return false;
                                }
                                activeBatchReview = await reviewOrchestrator.reviewBatch({
                                    batch: {
                                        name: batch.name,
                                        files: actualChangedFiles.length > 0 ? actualChangedFiles : executionBatch.files,
                                    },
                                    changedFiles: actualChangedFiles,
                                    changedDomains,
                                    mode: input.mode,
                                    changeContract,
                                    reviewLoop: createBatchReviewLoopContext(attempt, reviewLoopMaxAttempts),
                                });
                                currentBatchResult.batchReview = activeBatchReview;
                                return reviewPassed(activeBatchReview);
                            },
                        });
                        if (fixLoopResult.status === "FIX_LOOP_EXHAUSTED") {
                            return {
                                status: "FIX_LOOP_EXHAUSTED",
                                attempts: fixLoopResult.attempts,
                                strategyChangeRequired: fixLoopResult.strategyChangeRequired,
                                batchSize: planned.batchSize,
                                regressionProofs: planned.regressionProofs,
                                execution: {
                                    ...((batchResult.execution && typeof batchResult.execution === "object")
                                        ? batchResult.execution
                                        : {}),
                                    batchSize: planned.batchSize,
                                    regressionProofs: planned.regressionProofs,
                                },
                                review: batchResult.review,
                                batchReview: activeBatchReview,
                                validation: activeCheckpoint,
                                proof: {
                                    ...proof,
                                    checkpointEvidence,
                                    fixAttempts: appliedFixAttempts,
                                },
                                batches: planned.batches,
                                results: batchResults,
                            };
                        }
                        currentBatchResult.batchReview = activeBatchReview;
                        currentBatchResult.checkpoint = activeCheckpoint;
                    }
                    else {
                        return {
                            status: "blocked",
                            blockedBy: "BATCH_REVIEW_REWORK",
                            batchSize: planned.batchSize,
                            regressionProofs: planned.regressionProofs,
                            execution: batchResult.execution,
                            review: batchResult.review,
                            batchReview: activeBatchReview,
                            validation: activeCheckpoint,
                            proof: {
                                ...proof,
                                checkpointEvidence,
                                fixAttempts: appliedFixAttempts,
                            },
                            batches: planned.batches,
                            results: batchResults,
                        };
                    }
                }
                if (activeCheckpoint.status === "failed" && (dependencies.runRole || batchFixAttempts.length > 0)) {
                    const fixLoopResult = await runFixLoop({
                        strategy: "same-plan",
                        attemptFix: async ({ attempt, strategy }) => {
                            const fixDispatch = await withActiveChangeContract({
                                sessionRoot: currentSessionRoot,
                                changeContract,
                                action: () => dispatchExecutorFix({
                                    runRole: dependencies.runRole,
                                    batch: executionBatch,
                                    attempt,
                                    strategy,
                                    findings: batchResult.review && typeof batchResult.review === "object" && "findings" in batchResult.review
                                        ? batchResult.review.findings
                                        : undefined,
                                    changedDomains,
                                    sessionRoot: currentSessionRoot,
                                    sessionId: currentSessionId,
                                }),
                            });
                            const structuredResult = parseExecutorFixResult(fixDispatch && typeof fixDispatch === "object" && "output" in fixDispatch
                                ? fixDispatch.output
                                : undefined);
                            const result = structuredResult?.success ?? (batchFixAttempts[attempt - 1] ?? false);
                            appliedFixAttempts.push(result);
                            return result;
                        },
                    });
                    if (fixLoopResult.status === "FIX_LOOP_EXHAUSTED") {
                        return {
                            status: "FIX_LOOP_EXHAUSTED",
                            attempts: fixLoopResult.attempts,
                            strategyChangeRequired: fixLoopResult.strategyChangeRequired,
                            batchSize: planned.batchSize,
                            regressionProofs: planned.regressionProofs,
                            execution: {
                                ...((batchResult.execution && typeof batchResult.execution === "object")
                                    ? batchResult.execution
                                    : {}),
                                batchSize: planned.batchSize,
                                regressionProofs: planned.regressionProofs,
                            },
                            review: batchResult.review,
                            validation: activeCheckpoint,
                            proof: {
                                ...proof,
                                checkpointEvidence,
                                fixAttempts: appliedFixAttempts,
                            },
                            batches: planned.batches,
                            results: batchResults,
                        };
                    }
                }
                await recordBatchLoopEvidence({
                    gateLog: input.stores?.gateLog,
                    phase: input.phase,
                    batchName: batch.name,
                    checkpoint: activeCheckpoint,
                    batchReview: activeBatchReview,
                    openFindings: reviewOpenFindings(activeBatchReview),
                    attempts: appliedFixAttempts.length - batchFixAttemptStart,
                });
                if (activeCheckpoint.status === "STOP_RULE") {
                    return {
                        status: "STOP_RULE",
                        batchSize: planned.batchSize,
                        regressionProofs: planned.regressionProofs,
                        execution: {
                            ...((batchResult.execution && typeof batchResult.execution === "object")
                                ? batchResult.execution
                                : {}),
                            batchSize: planned.batchSize,
                            regressionProofs: planned.regressionProofs,
                        },
                        review: batchResult.review,
                        validation: activeCheckpoint,
                        proof: {
                            ...proof,
                            checkpointEvidence,
                            fixAttempts: appliedFixAttempts,
                        },
                        batches: planned.batches,
                        results: batchResults,
                    };
                }
                if (activeCheckpoint.status === "failed" && index === planned.batches.length - 1) {
                    return {
                        status: "failed",
                        batchSize: planned.batchSize,
                        regressionProofs: planned.regressionProofs,
                        execution: {
                            ...((batchResult.execution && typeof batchResult.execution === "object")
                                ? batchResult.execution
                                : {}),
                            batchSize: planned.batchSize,
                            regressionProofs: planned.regressionProofs,
                        },
                        review: batchResult.review,
                        validation: activeCheckpoint,
                        proof: {
                            ...proof,
                            checkpointEvidence,
                            fixAttempts: appliedFixAttempts,
                        },
                        batches: planned.batches,
                        results: batchResults,
                    };
                }
            }
            const lastResult = batchResults.at(-1);
            const finalScopeFiles = normalizeFiles(batchResults.flatMap((result) => result.changedFiles));
            const finalReview = await finalAdversarialOrchestrator({
                scope: {
                    files: finalScopeFiles.length > 0 ? finalScopeFiles : tasks,
                },
                changedDomains: detectChangedDomains(finalScopeFiles.length > 0 ? finalScopeFiles : tasks),
                reviews: batchResults.map((result) => {
                    const effectiveReview = summarizeEffectiveReview(result.batchReview ?? result.review);
                    return {
                        reviewer: result.batch.name,
                        status: effectiveReview.status,
                        findings: effectiveReview.findings,
                    };
                }),
            });
            if (finalReview.status === "rework" || finalReview.finalDecision === "blocked") {
                return {
                    status: "blocked",
                    blockedBy: "FINAL_ADVERSARIAL_REWORK",
                    batchSize: planned.batchSize,
                    regressionProofs: planned.regressionProofs,
                    execution: lastResult?.execution ?? null,
                    review: lastResult?.batchReview ?? lastResult?.review ?? null,
                    finalReview,
                    validation: lastResult?.checkpoint ?? null,
                    executionPlan: {
                        CHANGE_CONTRACT: changeContract,
                        batch_metadata: batchMetadata,
                    },
                    proof: {
                        ...proof,
                        checkpointEvidence,
                        fixAttempts: appliedFixAttempts,
                    },
                    batches: planned.batches,
                    results: batchResults,
                };
            }
            return markAuthoritativeFinalReviewResult({
                status: "completed",
                batchSize: planned.batchSize,
                regressionProofs: planned.regressionProofs,
                execution: lastResult
                    ? {
                        ...((lastResult.execution && typeof lastResult.execution === "object")
                            ? lastResult.execution
                            : {}),
                        batchSize: planned.batchSize,
                        regressionProofs: planned.regressionProofs,
                    }
                    : null,
                review: lastResult?.batchReview ?? lastResult?.review ?? null,
                finalReview,
                validation: lastResult?.checkpoint ?? null,
                executionPlan: {
                    CHANGE_CONTRACT: changeContract,
                    batch_metadata: batchMetadata,
                },
                proof: {
                    ...proof,
                    checkpointEvidence,
                    fixAttempts: appliedFixAttempts,
                },
                batches: planned.batches,
                results: batchResults,
            });
        },
        runFixLoop,
    };
}
