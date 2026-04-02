import { runAdversarialReview } from "../review/adversarial-review.js";
import { createFinalAdversarialOrchestrator } from "../review/final-adversarial-orchestrator.js";
import { detectChangedDomains } from "../review/domain-checklists.js";
import { runRole } from "../dispatcher/run-role.js";
import { createCheckpointValidator } from "./checkpoint-validator.js";
import { createPreTester } from "./pre-tester.js";
import { createQualityGateRouter } from "./quality-gate-router.js";
const authoritativeFinalReviewResultSymbol = Symbol("authoritative-final-review-result");
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
async function defaultRunBatch(batch, dependencies) {
    const executeRole = dependencies?.runRole ?? runRole;
    const adversarialReview = dependencies?.adversarialReview ?? runAdversarialReview;
    const execution = await executeRole({
        mode: "single-agent",
        role: "executor-implementer",
        prompt: "Implement only the current batch.",
        input: { batch },
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
function toExecutionBatch(batch) {
    return {
        name: batch.name,
        files: [...("tasks" in batch ? batch.tasks : batch.files)],
    };
}
function toPlannedBatch(batch) {
    return {
        name: batch.name,
        tasks: [...("tasks" in batch ? batch.tasks : batch.files)],
    };
}
function resolveComplexity(input) {
    if (input.complexity) {
        return input.complexity;
    }
    if (input.mode === "--complexa" || input.mode === "--plan" || input.mode === "--hotfix") {
        return "COMPLEXA";
    }
    if (input.mode === "--simples") {
        return "SIMPLES";
    }
    if (input.mode === "--media") {
        return "MEDIA";
    }
    return input.variant?.endsWith("heavy") ? "COMPLEXA" : "MEDIA";
}
function normalizeScenarioPath(path) {
    return path.replace(/\\/g, "/");
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
function markAuthoritativeFinalReviewResult(result) {
    Object.defineProperty(result, authoritativeFinalReviewResultSymbol, {
        value: true,
        enumerable: false,
    });
    return result;
}
export function hasAuthoritativeFinalReviewResult(result) {
    return !!result && typeof result === "object" && authoritativeFinalReviewResultSymbol in result;
}
export function createExecutorController(dependencies = {}) {
    const runBatch = dependencies.runBatch ?? ((batch) => defaultRunBatch(batch, {
        runRole: dependencies.runRole,
        adversarialReview: dependencies.adversarialReview,
        mode: currentExecutionMode,
    }));
    const qualityGateRouter = dependencies.qualityGateRouter ?? createQualityGateRouter();
    const preTester = dependencies.preTester ?? createPreTester();
    const finalAdversarialOrchestrator = dependencies.finalAdversarialOrchestrator
        ?? ((input) => createFinalAdversarialOrchestrator().reviewFinal(input));
    let currentExecutionMode;
    const runFixLoop = async (input) => {
        let strategy = input.strategy;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
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
            attempts: 3,
            strategyChangeRequired: true,
        };
    };
    return {
        async executeApprovedWork(input) {
            currentExecutionMode = input.mode;
            const checkpointValidator = dependencies.checkpointValidator ?? createCheckpointValidator();
            checkpointValidator.reset?.();
            const tasks = input.batch?.files ?? input.tasks ?? input.proposal?.affectedFiles ?? [];
            const complexity = resolveComplexity({
                mode: input.mode,
                complexity: input.complexity,
                variant: input.variant,
            });
            const planned = input.batch
                ? {
                    batchSize: input.batch.files.length || 1,
                    regressionProofs: input.mode === "--hotfix" || input.proposal?.validationIntent === "reduced"
                        ? 1
                        : 2,
                    approvedScenarios: [...(input.approvedScenarios ?? [])],
                    batches: [toPlannedBatch(input.batch)],
                }
                : qualityGateRouter.planBatches({
                    complexity,
                    tasks,
                    mode: input.mode,
                    validationIntent: input.proposal?.validationIntent,
                });
            const proof = preTester.deriveExecutionProof({
                approvedScenarios: input.approvedScenarios ?? [],
                cwd: input.workingDirectory,
            });
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
            for (const [index, batch] of planned.batches.entries()) {
                const executionBatch = toExecutionBatch(batch);
                const batchResult = await runBatch(executionBatch);
                const actualChangedFiles = extractExecutionChangedFiles(batchResult);
                const verificationEvidence = deriveControllerVerificationEvidence({
                    approvedScenarios: proof.approvedScenarios,
                    regressionProofs: planned.regressionProofs,
                    batchResult,
                });
                const batchFixAttempts = batchResult && typeof batchResult === "object" && "fixAttempts" in batchResult && Array.isArray(batchResult.fixAttempts)
                    ? batchResult.fixAttempts
                    : [];
                const checkpoint = checkpointValidator.validateCheckpoints({
                    verificationEvidence,
                    checkpointName: batch.name,
                });
                checkpointEvidence.push({
                    batchName: batch.name,
                    requiredCheckpoints: checkpoint.requiredCheckpoints,
                    verifiedCheckpoints: checkpoint.verifiedCheckpoints,
                    evidence: verificationEvidence?.evidence ?? [],
                });
                if (actualChangedFiles.length === 0) {
                    const missingEvidenceReview = createMissingChangedFilesReview(executionBatch);
                    batchResults.push({
                        batch,
                        changedFiles: [],
                        execution: batchResult.execution && typeof batchResult.execution === "object"
                            ? batchResult.execution
                            : {},
                        review: missingEvidenceReview,
                        checkpoint,
                    });
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
                batchResults.push({
                    batch,
                    changedFiles: actualChangedFiles,
                    execution: batchResult.execution && typeof batchResult.execution === "object"
                        ? batchResult.execution
                        : {},
                    review: batchResult.review,
                    checkpoint,
                });
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
                });
                if (checkpoint.status === "failed" && batchFixAttempts.length > 0) {
                    const fixLoopResult = await runFixLoop({
                        strategy: "same-plan",
                        attemptFix: ({ attempt }) => {
                            const result = batchFixAttempts[attempt - 1] ?? false;
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
                }
                if (checkpoint.status === "STOP_RULE") {
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
                if (checkpoint.status === "failed" && index === planned.batches.length - 1) {
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
            }
            const lastResult = batchResults.at(-1);
            const finalScopeFiles = normalizeFiles(batchResults.flatMap((result) => result.changedFiles));
            const finalReview = await finalAdversarialOrchestrator({
                scope: {
                    files: finalScopeFiles.length > 0 ? finalScopeFiles : tasks,
                },
                changedDomains: detectChangedDomains(finalScopeFiles.length > 0 ? finalScopeFiles : tasks),
                reviews: batchResults.map((result) => ({
                    reviewer: result.batch.name,
                    status: result.review
                        && typeof result.review === "object"
                        && "status" in result.review
                        && typeof result.review.status === "string"
                        ? result.review.status
                        : "approved",
                    findings: result.review
                        && typeof result.review === "object"
                        && "findings" in result.review
                        && Array.isArray(result.review.findings)
                        ? result.review.findings
                        : [],
                })),
            });
            if (finalReview.status === "rework" || finalReview.finalDecision === "blocked") {
                return {
                    status: "blocked",
                    blockedBy: "FINAL_ADVERSARIAL_REWORK",
                    batchSize: planned.batchSize,
                    regressionProofs: planned.regressionProofs,
                    execution: lastResult?.execution ?? null,
                    review: lastResult?.review ?? null,
                    finalReview,
                    validation: lastResult?.checkpoint ?? null,
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
                review: lastResult?.review ?? null,
                finalReview,
                validation: lastResult?.checkpoint ?? null,
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
