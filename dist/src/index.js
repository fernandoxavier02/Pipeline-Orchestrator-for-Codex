import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, join } from "node:path";
import { loadPipelineConfig } from "./config/load-pipeline-config.js";
import { buildPersistedCloseout } from "./closeout/persisted-closeout.js";
import { renderCloseout } from "./closeout/render-closeout.js";
import { createPipelineController } from "./controller/pipeline-controller.js";
import { findLatestRun } from "./continue/find-latest-run.js";
import { runRole } from "./dispatcher/run-role.js";
import { PIPELINE_MODES } from "./domain/pipeline-types.js";
import { createExecutorController } from "./execution/executor-controller.js";
import { createConfidenceModel } from "./gates/confidence-model.js";
import { createGateRegistry } from "./gates/gate-registry.js";
import { createPromptRegistry } from "./prompts/prompt-registry.js";
import { persistProtocolBlocksFromDispatch, processProtocolBlocksForParent, } from "./protocol/protocol-handler.js";
import { loadReferenceBundle } from "./references/load-reference-bundle.js";
import { createReferenceProfileIndex } from "./references/reference-profiles.js";
import { runAdversarialReview } from "./review/adversarial-review.js";
import { createFinalAdversarialOrchestrator } from "./review/final-adversarial-orchestrator.js";
import { createReviewOrchestrator } from "./review/review-orchestrator.js";
import { createCheckpointStore } from "./state/checkpoint-store.js";
import { createConfidenceScoreStore } from "./state/confidence-score.js";
import { createGateLog } from "./state/gate-log.js";
import { createSessionStore } from "./state/session-store.js";
import { createSentinelStateStore } from "./sentinel/sentinel-state.js";
import { writeTrace } from "./trace/trace.js";
import { recordPostFinalValidatorCheckpoint, resolveEffectiveGateLog, } from "./validation/final-validator.js";
function hasControllerCheckpointProof(input) {
    return input.checkpointEvidence.some((entry) => entry.batchName === input.batchName
        && entry.evidence.length > 0
        && entry.verifiedCheckpoints >= entry.requiredCheckpoints);
}
function resolveAuthoritativeEvidenceKinds(input) {
    const checkpointEvidence = input.session?.executionProof?.checkpointEvidence ?? [];
    const evidenceKinds = new Set();
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
    const finalReviewRecorded = input.gateLog.some((entry) => entry.gate === "FINAL_ADVERSARIAL_GATE"
        && entry.decision === "pass"
        && entry.decided_by === "controller");
    if (!requiresReducedValidation && finalReviewRecorded) {
        evidenceKinds.add("final-review");
    }
    return evidenceKinds;
}
function resolveCloseoutScopeStartedAt(input) {
    const runStartedAt = input.session?.runStartedAt;
    if (runStartedAt) {
        const runStartedAtMs = Date.parse(runStartedAt);
        if (!Number.isNaN(runStartedAtMs)) {
            return runStartedAt;
        }
    }
    const activeBatchNames = new Set(input.batches.map((batch) => batch.name));
    const latestCheckpointTimes = new Map();
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
function filterCloseoutGateLogForSession(input) {
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
function resolveRuntimePromptName(role) {
    if (role === "executor-implementer") {
        return "executor/executor-implementer";
    }
    if (role === "executor-fix") {
        return "executor/executor-fix";
    }
    if (role === "executor-spec-reviewer") {
        return "executor/executor-spec-reviewer";
    }
    if (role === "pre-tester") {
        return "quality/pre-tester";
    }
    if (role === "quality-gate-router") {
        return "quality/quality-gate-router";
    }
    if (role === "batch-reviewer") {
        return "quality/adversarial-reviewer";
    }
    if (role === "review-orchestrator") {
        return "quality/review-orchestrator";
    }
    if (role === "final-adversarial-orchestrator") {
        return "quality/final-adversarial-orchestrator";
    }
    if (role === "quality-reviewer") {
        return "quality/quality-reviewer";
    }
    if (role === "security-reviewer") {
        return "quality/security-reviewer";
    }
    if (role === "architecture-reviewer") {
        return "quality/architecture-reviewer";
    }
    if (role === "spec-format-gate") {
        return "quality/spec-format-gate";
    }
    if (role === "spec-content-reviewer") {
        return "quality/spec-content-reviewer";
    }
    if (role === "spec-post-impl-validator") {
        return "quality/spec-post-impl-validator";
    }
    if (role === "spec-closer") {
        return "quality/spec-closer";
    }
    if (role === "information-gate") {
        return "core/information-gate";
    }
    if (role === "sanity-checker") {
        return "core/sanity-checker";
    }
    if (role === "final-validator") {
        return "core/final-validator";
    }
    return undefined;
}
function uniqueExistingPromptRoots(roots) {
    return [...new Set(roots)]
        .filter((root) => existsSync(join(root, "prompts")));
}
function hasReferenceBundle(root) {
    return existsSync(join(root, "references", "complexity-matrix.md"));
}
function resolveReferenceRoot(roots) {
    const resolved = [...new Set(roots)]
        .filter((root) => root.length > 0)
        .find(hasReferenceBundle);
    if (!resolved) {
        return roots[0];
    }
    return resolved;
}
function parseSanityCheckerResult(output) {
    if (!output || typeof output !== "object") {
        return undefined;
    }
    const candidate = output;
    const status = candidate.status ?? candidate.STATUS;
    const evidence = Array.isArray(candidate.evidence)
        ? candidate.evidence.filter((entry) => typeof entry === "string")
        : Array.isArray(candidate.EVIDENCE)
            ? candidate.EVIDENCE.filter((entry) => typeof entry === "string")
            : [];
    const missingEvidence = Array.isArray(candidate.missingEvidence)
        ? candidate.missingEvidence.filter((entry) => typeof entry === "string")
        : [];
    if (status !== "approved" && status !== "blocked") {
        return undefined;
    }
    return {
        status,
        evidence,
        missingEvidence,
    };
}
function dispatchOutputText(output) {
    return Object.values(output)
        .filter((value) => typeof value === "string")
        .join("\n\n");
}
function containsPipelineCompletion(text) {
    return /\bPIPELINE COMPLETE\b/u.test(text);
}
function isOperationalPipelineDispatch(request) {
    const requestText = typeof request.input?.request === "string" ? request.input.request.trim() : "";
    if (!requestText.startsWith("/pipeline-orchestrator-for-codex:pipeline")) {
        return false;
    }
    return !requestText.startsWith("/pipeline-orchestrator-for-codex:pipeline diagnostic");
}
function isBrainstormInteractiveRole(role) {
    return role === "brainstorm-controller"
        || role.endsWith(":core:brainstorm-controller")
        || role === "step-01-explore"
        || role.endsWith(":brainstorm:step-01-explore");
}
function normalizeDispatchPhase(phase) {
    if (phase === "phase-0"
        || phase === "phase-1"
        || phase === "phase-1.5"
        || phase === "phase-2"
        || phase === "phase-3"
        || phase === "continue") {
        return phase;
    }
    return "phase-2";
}
function promptCarriesBrainstormGateResponses(prompt) {
    return /(?:^|\n)GATE_RESPONSES:\s*\n[\s\S]*brainstorm-explore-(?:q\d+|no-gaps)\b/u.test(prompt);
}
async function stateCarriesAnsweredBrainstormGate(stateDir) {
    try {
        const raw = await readFile(join(stateDir, "protocol-events.jsonl"), "utf8");
        return raw.split(/\r?\n/u).some((line) => (line.includes("\"status\":\"answered\"")
            && /brainstorm-explore-(?:q\d+|no-gaps)/u.test(line)));
    }
    catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}
function parseFinalValidatorResult(output) {
    if (!output || typeof output !== "object") {
        return undefined;
    }
    const candidate = output;
    const decision = candidate.decision ?? candidate.DECISION;
    const confidenceScore = candidate.confidenceScore;
    const confidenceBand = candidate.confidenceBand;
    const requiredEvidence = Array.isArray(candidate.requiredEvidence)
        ? candidate.requiredEvidence.filter((entry) => typeof entry === "string")
        : undefined;
    const missingEvidence = Array.isArray(candidate.missingEvidence)
        ? candidate.missingEvidence.filter((entry) => typeof entry === "string")
        : undefined;
    const verificationEvidence = Array.isArray(candidate.verificationEvidence)
        ? candidate.verificationEvidence
            .filter((entry) => !!entry
            && typeof entry === "object"
            && typeof entry.kind === "string"
            && typeof entry.passed === "boolean")
            .map((entry) => ({
            kind: entry.kind,
            passed: entry.passed,
            label: typeof entry.label === "string" ? entry.label : undefined,
        }))
        : undefined;
    const blockingGates = Array.isArray(candidate.blockingGates)
        ? candidate.blockingGates.filter((entry) => typeof entry === "string")
        : undefined;
    const skippedSoftGates = Array.isArray(candidate.skippedSoftGates)
        ? candidate.skippedSoftGates.filter((entry) => typeof entry === "string")
        : undefined;
    const blockedReviews = candidate.blockedReviews;
    const rollbackHint = typeof candidate.rollbackHint === "string" ? candidate.rollbackHint : undefined;
    if (decision !== "GO"
        && decision !== "CONDITIONAL"
        && decision !== "NO-GO") {
        return undefined;
    }
    if (typeof confidenceScore !== "number"
        || (confidenceBand !== "low" && confidenceBand !== "medium" && confidenceBand !== "high")
        || !requiredEvidence
        || !missingEvidence
        || !verificationEvidence
        || !blockingGates
        || !skippedSoftGates
        || typeof blockedReviews !== "number") {
        return undefined;
    }
    return {
        decision,
        confidenceScore,
        confidenceBand,
        requiredEvidence,
        missingEvidence,
        verificationEvidence,
        blockingGates,
        skippedSoftGates,
        blockedReviews,
        rollbackHint,
    };
}
async function loadCloseoutSession(input) {
    if (!input.load) {
        return undefined;
    }
    try {
        return await input.load();
    }
    catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return undefined;
        }
        throw error;
    }
}
export function createPipelineRuntime(options) {
    const config = loadPipelineConfig(options.cwd);
    const bundledPromptRoot = fileURLToPath(new URL("../", import.meta.url));
    const sourcePromptRoot = fileURLToPath(new URL("../../", import.meta.url));
    const promptFallbackRoots = uniqueExistingPromptRoots([
        process.env.CODEX_PLUGIN_ROOT ?? "",
        process.env.CLAUDE_PLUGIN_ROOT ?? "",
        bundledPromptRoot,
        sourcePromptRoot,
    ].filter((root) => root.length > 0));
    const referenceRoot = resolveReferenceRoot([
        options.cwd,
        process.env.CODEX_PLUGIN_ROOT ?? "",
        process.env.CLAUDE_PLUGIN_ROOT ?? "",
        bundledPromptRoot,
        sourcePromptRoot,
    ]);
    const stateDir = `${options.cwd}/.codex/pipeline`;
    const sessionStore = createSessionStore(stateDir);
    const checkpointStore = createCheckpointStore(stateDir);
    const gateLogStore = createGateLog(stateDir);
    const confidenceStore = createConfidenceScoreStore(stateDir);
    const sentinelStore = createSentinelStateStore(stateDir);
    const promptRegistry = createPromptRegistry(options.cwd, {
        fallbackRoots: promptFallbackRoots,
    });
    const controllerStores = {
        session: sessionStore,
        checkpoints: checkpointStore,
        gateLog: gateLogStore,
        confidence: confidenceStore,
        sentinel: sentinelStore,
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
        let referenceIndexPromise;
        return () => {
            referenceIndexPromise ??= loadReferenceBundle(referenceRoot).then(createReferenceProfileIndex);
            return referenceIndexPromise;
        };
    })();
    const runtimeRunRole = async (request) => {
        const withRuntimePrompt = async (role, prompt) => {
            const promptName = resolveRuntimePromptName(role);
            if (!promptName) {
                return prompt;
            }
            return [
                await promptRegistry.load(promptName),
                prompt,
            ].filter((part) => part.length > 0).join("\n\n");
        };
        const prompt = await withRuntimePrompt(request.role, request.prompt);
        const team = request.team
            ? await Promise.all(request.team.map(async (member) => ({
                ...member,
                prompt: await withRuntimePrompt(member.role, member.prompt),
            })))
            : undefined;
        const result = await runRole({
            ...request,
            requireRealAgent: request.requireRealAgent ?? options.strictAgents ?? isOperationalPipelineDispatch(request),
            agentRuntime: request.agentRuntime ?? options.agentRuntime,
            prompt,
            team,
        });
        const protocolBlocks = await persistProtocolBlocksFromDispatch({
            stateRoot: stateDir,
            dispatch: result,
            source: request.role,
        });
        let pendingProtocolBlocks = protocolBlocks;
        let parentDispatchResults = [];
        if (options.agentRuntime && protocolBlocks.some((block) => block.kind === "DISPATCH_REQUEST")) {
            const dispatchViaRuntime = async (protocolRequest) => {
                const childResult = await runtimeRunRole({
                    mode: "single-agent",
                    role: protocolRequest.targetName,
                    phase: normalizeDispatchPhase(protocolRequest.phase),
                    prompt: protocolRequest.prompt
                        ?? protocolRequest.description
                        ?? `Process protocol dispatch ${protocolRequest.dispatchId}.`,
                    input: {
                        dispatchId: protocolRequest.dispatchId,
                        targetKind: protocolRequest.targetKind,
                        description: protocolRequest.description,
                    },
                    expectedOutput: [],
                    freshContext: true,
                    reviewOnly: false,
                    filesInScope: [],
                    authorityLevel: "reviewer",
                    requireRealAgent: true,
                    agentRuntime: options.agentRuntime,
                });
                return childResult.output;
            };
            const parentDispatch = await processProtocolBlocksForParent({
                stateRoot: stateDir,
                blocks: protocolBlocks.filter((block) => block.kind === "DISPATCH_REQUEST"),
                source: "runtime-parent-handler",
                adapters: {
                    dispatchAgent: dispatchViaRuntime,
                    dispatchSkill: dispatchViaRuntime,
                    async answerGate(request) {
                        throw new Error(`GATE_REQUEST ${request.gateId} requires parent/user action.`);
                    },
                    async fulfillPlanMode(request) {
                        throw new Error(`PLAN_MODE_REQUEST ${request.planId} requires parent plan-mode action.`);
                    },
                },
            });
            parentDispatchResults = parentDispatch.dispatchResults;
            pendingProtocolBlocks = protocolBlocks.filter((block) => block.kind !== "DISPATCH_REQUEST");
            if (pendingProtocolBlocks.length === 0) {
                return {
                    ...result,
                    output: {
                        ...result.output,
                        protocolStatus: "parent-dispatch-completed",
                        parentDispatchResults,
                    },
                };
            }
        }
        if (pendingProtocolBlocks.length === 0
            && isBrainstormInteractiveRole(request.role)
            && !promptCarriesBrainstormGateResponses(prompt)
            && !(await stateCarriesAnsweredBrainstormGate(stateDir))) {
            const attemptedOutputText = dispatchOutputText(result.output);
            return {
                ...result,
                output: {
                    ...result.output,
                    text: [
                        "BLOCKED: brainstorm attempted to continue without an interactive GATE_REQUEST response.",
                        "The parent must collect GATE_RESPONSES for brainstorm-explore-q<N> or brainstorm-explore-no-gaps before synthesis, spec, report, plan, or handoff.",
                    ].join("\n"),
                    attemptedOutputText,
                    status: "blocked",
                    protocolStatus: "blocked-missing-brainstorm-gate",
                    blockedReason: "missing answered brainstorm GATE_REQUEST",
                },
            };
        }
        if (pendingProtocolBlocks.length === 0) {
            return result;
        }
        const attemptedOutputText = dispatchOutputText(result.output);
        if (containsPipelineCompletion(attemptedOutputText)) {
            return {
                ...result,
                output: {
                    ...result.output,
                    text: [
                        "BLOCKED: pipeline attempted to complete while protocol blocks were awaiting parent action.",
                        "The parent must process every GATE_REQUEST, DISPATCH_REQUEST, and PLAN_MODE_REQUEST before PIPELINE COMPLETE is accepted.",
                    ].join("\n"),
                    attemptedOutputText,
                    status: "blocked",
                    protocolStatus: "blocked-awaiting-parent-action",
                    blockedReason: "protocol blocks pending parent action",
                    parentDispatchResults: parentDispatchResults.length > 0 ? parentDispatchResults : undefined,
                    protocolEvents: pendingProtocolBlocks.map((block) => ({
                        kind: block.kind,
                        id: block.kind === "GATE_REQUEST"
                            ? block.gate_id
                            : block.kind === "DISPATCH_REQUEST"
                                ? block.dispatch_id
                                : block.plan_id,
                    })),
                },
            };
        }
        return {
            ...result,
            output: {
                ...result.output,
                protocolStatus: "awaiting-parent-action",
                parentDispatchResults: parentDispatchResults.length > 0 ? parentDispatchResults : undefined,
                protocolEvents: pendingProtocolBlocks.map((block) => ({
                    kind: block.kind,
                    id: block.kind === "GATE_REQUEST"
                        ? block.gate_id
                        : block.kind === "DISPATCH_REQUEST"
                            ? block.dispatch_id
                            : block.plan_id,
                })),
            },
        };
    };
    const runtimeReviewOrchestrator = createReviewOrchestrator({
        runRole: runtimeRunRole,
        requireRealAgent: options.strictAgents === true,
    });
    const runtimeExecutionController = createExecutorController({
        runRole: runtimeRunRole,
        adversarialReview: (input) => runAdversarialReview({
            ...input,
            reviewOrchestrator: runtimeReviewOrchestrator,
        }),
        finalAdversarialOrchestrator: (input) => createFinalAdversarialOrchestrator({
            runRole: runtimeRunRole,
            requireRealAgent: options.strictAgents === true,
        }).reviewFinal({
            scope: input.scope,
            changedDomains: input.changedDomains,
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
            "core/checkpoint-validator",
            "core/final-validator",
            "core/sanity-checker",
            "core/sentinel",
            "executor/executor-fix",
            "executor/executor-implementer",
            "executor/executor-spec-reviewer",
            "quality/adversarial-reviewer",
            "quality/architecture-reviewer",
            "quality/design-interrogator",
            "quality/final-adversarial-orchestrator",
            "quality/plan-architect",
            "quality/pre-tester",
            "quality/quality-gate-router",
            "quality/quality-reviewer",
            "quality/review-orchestrator",
            "quality/security-reviewer",
            "quality/spec-format-gate",
            "quality/spec-content-reviewer",
            "quality/spec-post-impl-validator",
            "quality/spec-closer",
        ]);
    };
    const confidenceModel = createConfidenceModel();
    const gateRegistry = createGateRegistry();
    async function resolveCloseoutStores() {
        let latestRun;
        try {
            latestRun = await findLatestRun(stateDir);
        }
        catch (error) {
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
            sentinel: createSentinelStateStore(runDir),
        };
    }
    function getEvidenceLabel(input) {
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
            async start(input) {
                await ensureRuntimePrompts();
                return baseController.start(input);
            },
        },
        closeout: {
            async finalize(input) {
                const closeoutStores = await resolveCloseoutStores();
                const checkpoints = await closeoutStores.checkpoints.list();
                const existingGateLog = await closeoutStores.gateLog.list();
                const session = await loadCloseoutSession({
                    load: closeoutStores.session.load,
                });
                const appendedEntries = [
                    {
                        gate: "CLOSEOUT_CONFIRM",
                        hardness: gateRegistry.get("CLOSEOUT_CONFIRM").hardness,
                        phase: "phase-3",
                        decision: input.confirmed ? "pass" : "skip",
                        decided_by: "controller",
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
                        decided_by: "controller",
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
                const sanityDispatch = await runtimeRunRole({
                    mode: "single-agent",
                    role: "sanity-checker",
                    prompt: "Run final proportional verification before the final decision.",
                    input: {
                        verificationEvidence,
                        validationIntent: input.validationIntent,
                        mode: input.mode,
                    },
                    filesInScope: [],
                    authorityLevel: "controller",
                    freshContext: true,
                    reviewOnly: false,
                });
                const sanityCheck = parseSanityCheckerResult(sanityDispatch && typeof sanityDispatch === "object" && "output" in sanityDispatch
                    ? sanityDispatch.output
                    : undefined);
                if (!sanityCheck) {
                    throw new Error("sanity-checker returned an invalid runtime result");
                }
                const gateLog = effectiveGateLog;
                const validationInput = {
                    reviews: sanityCheck.status === "approved"
                        ? input.reviews
                        : [...input.reviews, { status: "blocked" }],
                    confidenceScore: nextConfidence.score,
                    gateLog,
                    verificationEvidence,
                    validationIntent: input.validationIntent,
                    mode: input.mode,
                    dispatchMode: input.mode === "full"
                        ? options.strictAgents ? "real-agent" : "harness"
                        : undefined,
                };
                const finalValidatorDispatch = await runtimeRunRole({
                    mode: "single-agent",
                    role: "final-validator",
                    prompt: "Issue the final GO, CONDITIONAL, or NO-GO decision from authoritative evidence.",
                    input: validationInput,
                    filesInScope: [],
                    authorityLevel: "controller",
                    freshContext: true,
                    reviewOnly: false,
                });
                const validation = parseFinalValidatorResult(finalValidatorDispatch && typeof finalValidatorDispatch === "object" && "output" in finalValidatorDispatch
                    ? finalValidatorDispatch.output
                    : undefined);
                if (!validation) {
                    throw new Error("final-validator returned an invalid runtime result");
                }
                const tracePath = join(closeoutStores.runDir, "TRACE.md");
                await writeTrace(tracePath, {
                    runId: basename(closeoutStores.runDir),
                    classification: {
                        type: "Unknown",
                        complexity: "unknown",
                        variant: "unknown",
                    },
                    pipeline: {
                        mode: input.mode ?? "FULL",
                        dispatchMode: options.strictAgents ? "real-agent" : "harness",
                    },
                    executionLog: effectiveGateLog.map((entry) => `${entry.phase ?? "unknown"}:${entry.gate}:${entry.decision}`),
                    finalVerdict: validation.decision,
                });
                await recordPostFinalValidatorCheckpoint({
                    sentinelStore: closeoutStores.sentinel,
                    decision: validation.decision,
                    batchIndex: session?.batchIndex,
                });
                const closeoutPackage = buildPersistedCloseout({
                    validation,
                    verificationEvidence,
                    batches: input.batches,
                    validationIntent: input.validationIntent,
                    updatedAt: new Date().toISOString(),
                });
                if (session) {
                    await closeoutStores.session.save({
                        ...session,
                        closeout: closeoutPackage.closeout,
                    });
                    const text = renderCloseout({
                        ...closeoutPackage.renderInput,
                    });
                    return {
                        ...validation,
                        text,
                        tracePath,
                    };
                }
                const text = renderCloseout({
                    ...closeoutPackage.renderInput,
                });
                return {
                    ...validation,
                    text,
                    tracePath,
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
