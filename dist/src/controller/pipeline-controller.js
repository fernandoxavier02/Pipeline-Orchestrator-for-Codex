import { PIPELINE_MODES } from "../domain/pipeline-types.js";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildExecWindow } from "../security/exec-window.js";
import { createExecWindowStore } from "../security/exec-window-store.js";
import { buildSessionLock, sessionLockPath, writeSessionLockAtomic } from "../security/session-lock.js";
import { resumePipeline } from "../continue/resume-pipeline.js";
import { findLatestRun } from "../continue/find-latest-run.js";
import { buildProposal } from "./build-proposal.js";
import { classifyRequest } from "./classify-request.js";
import { applyClassificationOverrides } from "./classification-overrides.js";
import { confirmProposal } from "./confirm-proposal.js";
import { runDesignInterrogation } from "./design-interrogator.js";
import { getPlanModeStatus, createImplementationPlan } from "./plan-mode.js";
import { defaultBatchSizeForWorkflow, resolveWorkflowSwitch } from "./workflow-selection.js";
import { parseMode } from "./parse-mode.js";
import { deriveContinuationOutcome } from "./continuation-outcome.js";
import { resolveContinueRollbackState, } from "./continue-state.js";
import { runInformationGate } from "../gates/information-gate.js";
import { createConfidenceModel } from "../gates/confidence-model.js";
import { assessStaleContext } from "../gates/stale-context.js";
import { createGateRegistry } from "../gates/gate-registry.js";
import { createCheckpointStore } from "../state/checkpoint-store.js";
import { createControllerLockStore } from "../state/controller-lock.js";
import { createConfidenceScoreStore } from "../state/confidence-score.js";
import { createGateLog, inferDecidedBy } from "../state/gate-log.js";
import { createSessionStore } from "../state/session-store.js";
import { createSentinelStateStore } from "../sentinel/sentinel-state.js";
import { createProtocolEventLog } from "../protocol/protocol-events.js";
import { recordProtocolGateResponse } from "../protocol/protocol-handler.js";
import { createStateAdapter } from "./state-adapter.js";
import { createExecutorController, hasAuthoritativeFinalReviewResult } from "../execution/executor-controller.js";
import { resolveExecutionComplexity } from "../modes/complexity-resolution.js";
import { createReviewOrchestrator } from "../review/review-orchestrator.js";
import { detectChangedDomains } from "../review/domain-checklists.js";
import { deriveSpecIdFromRequest, isSpecLifecycleVariant, validateSpecAcceptanceTraceability, validateSpecContentReviewGate, validateSpecFormatGate, validateSpecLifecycleArtifacts, validateSpecPostImplementationGate, } from "../spec/spec-lifecycle.js";
import { createBlockedPipelineArtifact, evaluateCapabilities, isExplicitPipelineRequest, } from "../governance/pipeline-contract.js";
import ts from "typescript";
function isPipelineMode(value) {
    return typeof value === "string" && PIPELINE_MODES.includes(value);
}
function resolveSessionPipelineMode(sessionMode, fallback) {
    return isPipelineMode(sessionMode) ? sessionMode : fallback;
}
function shouldAdvanceLegacyPlanningSession(session) {
    return session.currentPhase === "phase-1"
        && !session.proposal
        && (session.mode === "--complexa" || session.mode === "--plan");
}
function hasControllerManagedPhaseOnePointFiveTransition(session) {
    return session.approvalProof?.kind === "controller-managed-transition"
        && session.approvalProof.from === "phase-1"
        && session.approvalProof.to === "phase-1.5";
}
function getStateRoot(runtime) {
    return runtime?.stores?.session?.root
        ?? runtime?.stores?.checkpoints?.root
        ?? runtime?.stores?.gateLog?.root
        ?? runtime?.stores?.confidence?.root
        ?? runtime?.stores?.sentinel?.root;
}
function getExecutionController(runtime) {
    return runtime?.executionController ?? createExecutorController();
}
function getReviewOrchestrator(runtime) {
    return runtime?.reviewOrchestrator ?? createReviewOrchestrator();
}
function getWorkspaceRoot(runtime) {
    return runtime?.workspaceRoot ?? process.cwd();
}
async function loadSentinelState(runtime) {
    try {
        return await runtime?.stores?.sentinel?.load?.();
    }
    catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return undefined;
        }
        throw error;
    }
}
async function saveSentinelState(runtime, input) {
    await runtime?.stores?.sentinel?.save?.({
        ...input,
        updatedAt: new Date().toISOString(),
    });
}
function getExpectedSentinelToken(session) {
    if (session?.currentPhase === "phase-1.5") {
        return "phase-1.5-response";
    }
    return "proposal-response";
}
async function executeApprovedContinuation(input) {
    if (input.session.pendingDecision === "phase-1.5-approval-required"
        || input.session.pendingDecision === "phase-1.5-reapproval-required") {
        const proof = revokeExecutionApproval(input.session.executionProof);
        await input.runtime?.stores?.session?.save?.({
            ...input.session,
            currentPhase: input.session.currentPhase,
            phase: input.session.phase ?? input.session.currentPhase,
            executionProof: proof,
            touchedFiles: input.session.touchedFiles ?? input.session.proposal?.affectedFiles ?? [],
        });
        return {
            status: "blocked",
            blockedBy: "TDD_APPROVAL",
            proof,
            mode: input.mode,
            phase: input.session.currentPhase,
        };
    }
    const specPhaseTwoBlock = evaluateSpecPhaseGate({
        workspaceRoot: getWorkspaceRoot(input.runtime),
        variant: input.session.variant ?? input.session.proposal?.variant ?? "",
        specId: resolveSpecIdFromSession(input.session),
        phase: "phase-2",
    });
    if (specPhaseTwoBlock) {
        return blockForSpecPhaseGate({
            runtime: input.runtime,
            session: input.session,
            mode: input.mode,
            block: specPhaseTwoBlock,
        });
    }
    const executionController = getExecutionController(input.runtime);
    const validationIntent = (input.session.proposal?.validationIntent ?? "standard");
    const authoritativeExecutionProof = approveExecutionScenarios({
        executionProof: input.session.executionProof,
        proposal: input.session.proposal,
        cwd: getWorkspaceRoot(input.runtime),
    });
    const proposal = input.session.proposal
        ? {
            summary: input.session.proposal.summary ?? "",
            affectedFiles: input.session.proposal.affectedFiles ?? [],
            validationIntent,
            batchSize: input.session.proposal.batchSize ?? Math.max(1, (input.session.proposal.affectedFiles ?? []).length),
        }
        : undefined;
    // IMP-01: derive exec-window root and open a write-authorization window for this dispatch.
    // Falls back to <workspaceRoot>/.codex/pipeline when no stateRoot is available (legacy/test paths).
    const execWindowRoot = getStateRoot(input.runtime)
        ?? join(getWorkspaceRoot(input.runtime), ".codex", "pipeline");
    const execWindowSessionId = input.session.sessionId;
    const execWindowStore = execWindowSessionId
        ? createExecWindowStore(execWindowRoot)
        : undefined;
    if (execWindowStore && execWindowSessionId) {
        execWindowStore.write(execWindowSessionId, buildExecWindow({
            session_id: execWindowSessionId,
            now: Math.floor(Date.now() / 1000),
            purpose: "controller-managed-execution-phase-2",
            spawning_agent: "pipeline-controller",
        }));
    }
    let executionResult;
    try {
        executionResult = await executionController.executeApprovedWork({
            phase: input.session.currentPhase,
            mode: input.session.mode ?? input.mode,
            complexity: resolveExecutionComplexity({
                mode: input.session.mode ?? input.mode,
                variant: input.session.variant ?? input.session.proposal?.variant ?? "feature-light",
            }),
            variant: input.session.variant ?? input.session.proposal?.variant ?? "feature-light",
            proposal,
            changeContract: input.session.proposal?.CHANGE_CONTRACT,
            tasks: input.session.proposal?.affectedFiles ?? input.session.touchedFiles ?? [],
            approvedScenarios: authoritativeExecutionProof.approvedScenarios,
            workingDirectory: getWorkspaceRoot(input.runtime),
            stores: input.runtime?.stores,
            sessionRoot: execWindowSessionId ? execWindowRoot : undefined,
            sessionId: execWindowSessionId,
        });
    }
    finally {
        // Close exec-window — revokes write authorization regardless of outcome.
        if (execWindowStore && execWindowSessionId) {
            execWindowStore.delete(execWindowSessionId);
        }
    }
    const executionPayload = executionResult && typeof executionResult === "object"
        ? executionResult
        : {};
    const specPhaseThreeBlock = evaluateSpecPhaseGate({
        workspaceRoot: getWorkspaceRoot(input.runtime),
        variant: input.session.variant ?? input.session.proposal?.variant ?? "",
        specId: resolveSpecIdFromSession(input.session),
        phase: "phase-3",
    });
    if (specPhaseThreeBlock) {
        return blockForSpecPhaseGate({
            runtime: input.runtime,
            session: input.session,
            mode: input.mode,
            block: specPhaseThreeBlock,
        });
    }
    const executionStatus = "status" in executionPayload && typeof executionPayload.status === "string"
        ? executionPayload.status
        : undefined;
    const continuationOutcome = deriveContinuationOutcome({
        executionResult: executionPayload,
    });
    const { blocker, nextPhase, pendingDecision, checkpointFailure: isCheckpointFailure, circuitBreaker: isCircuitBreaker, } = continuationOutcome;
    const isFinalAdversarialRework = blocker === "FINAL_ADVERSARIAL_REWORK";
    if (isCircuitBreaker || isCheckpointFailure) {
        await persistGateAndConfidence({
            stores: {
                gateLog: input.runtime?.stores?.gateLog,
                confidence: input.runtime?.stores?.confidence,
                stateAdapter: input.runtime?.stores?.stateAdapter,
            },
        }, [
            toGateLogEntry({
                gate: blocker ?? executionStatus ?? "CHECKPOINT_FAIL",
                hardness: isCircuitBreaker ? "CIRCUIT_BREAKER" : "HARD",
                phase: "phase-2",
                decision: "block",
                detail: `${blocker ?? executionStatus ?? "CHECKPOINT_FAIL"} halted execution during controller-managed phase 2`,
            }),
        ], input.session.confidenceScore ?? 1);
    }
    const finalReviewStatus = "finalReview" in executionPayload
        && executionPayload.finalReview
        && typeof executionPayload.finalReview === "object"
        && "status" in executionPayload.finalReview
        && typeof executionPayload.finalReview.status === "string"
        ? executionPayload.finalReview.status
        : undefined;
    const finalReviewDecision = "finalReview" in executionPayload
        && executionPayload.finalReview
        && typeof executionPayload.finalReview === "object"
        && "finalDecision" in executionPayload.finalReview
        && typeof executionPayload.finalReview.finalDecision === "string"
        ? executionPayload.finalReview.finalDecision
        : undefined;
    if (hasAuthoritativeFinalReviewResult(executionPayload) && !isFinalAdversarialRework && !isCircuitBreaker && !isCheckpointFailure) {
        // IMP-02: load prior sentinel state so completedPhases is merged rather than hardcoded.
        const priorSentinel = await loadSentinelState(input.runtime);
        const priorCompleted = priorSentinel?.completedPhases ?? [];
        const phase2CompletedPhases = [...new Set([...priorCompleted, "phase-2"])];
        if (finalReviewStatus === "approved" && finalReviewDecision === "approved") {
            await persistGateAndConfidence({
                stores: {
                    gateLog: input.runtime?.stores?.gateLog,
                    confidence: input.runtime?.stores?.confidence,
                },
            }, [
                toGateLogEntry({
                    gate: "FINAL_ADVERSARIAL_GATE",
                    hardness: "SOFT",
                    phase: "phase-3",
                    decision: "pass",
                    detail: "Final adversarial review completed successfully during controller-managed execution.",
                }),
            ], input.session.confidenceScore ?? 1);
        }
        // IMP-02 + IMP-03: write phase_2_to_3 for ALL successful completion paths (adversarial or not).
        await saveSentinelState(input.runtime, {
            pipelineActive: true,
            currentPhase: "phase-2",
            currentAgent: "pipeline-controller",
            expectedNext: ["sanity-checker", "final-validator"],
            completedPhases: phase2CompletedPhases,
            gateSummary: ["SENTINEL_CHECKPOINT"],
            batchState: {
                batchIndex: input.session.batchIndex ?? 0,
                status: "phase-2-complete",
            },
            consecutiveCorrections: 0,
            lastCheckpoint: "phase_2_to_3",
        });
        await persistGateAndConfidence({
            stores: {
                gateLog: input.runtime?.stores?.gateLog,
                confidence: input.runtime?.stores?.confidence,
                stateAdapter: input.runtime?.stores?.stateAdapter,
            },
        }, [
            toGateLogEntry({
                gate: "SENTINEL_CHECKPOINT",
                hardness: "HARD",
                phase: "phase-2",
                decision: "pass",
                detail: "Sentinel recorded phase_2_to_3 transition.",
            }),
        ], input.session.confidenceScore ?? 1);
    }
    if (blocker === "FINAL_ADVERSARIAL_REWORK") {
        await persistGateAndConfidence({
            stores: {
                gateLog: input.runtime?.stores?.gateLog,
                confidence: input.runtime?.stores?.confidence,
                stateAdapter: input.runtime?.stores?.stateAdapter,
            },
        }, [
            toGateLogEntry({
                gate: "FINAL_ADVERSARIAL_REWORK",
                hardness: "HARD",
                phase: "phase-3",
                decision: "block",
                detail: "Final adversarial review required rework before closeout.",
            }),
        ], input.session.confidenceScore ?? 1);
    }
    await input.runtime?.stores?.session?.save?.({
        ...input.session,
        currentPhase: nextPhase,
        phase: nextPhase,
        batchIndex: executionStatus === "blocked" ? input.session.batchIndex ?? 0 : (input.session.batchIndex ?? 0) + 1,
        unresolvedBlockers: blocker ? [blocker] : [],
        pendingDecision,
        executionProof: "proof" in executionPayload && executionPayload.proof && typeof executionPayload.proof === "object"
            ? executionPayload.proof
            : input.session.executionProof,
        touchedFiles: input.session.touchedFiles ?? input.session.proposal?.affectedFiles ?? [],
    });
    if (isCheckpointFailure) {
        return {
            ...executionPayload,
            status: "blocked",
            blockedBy: blocker,
            mode: input.mode,
            phase: nextPhase,
        };
    }
    return {
        ...executionPayload,
        mode: input.mode,
        phase: nextPhase,
    };
}
function createInitialExecutionProof() {
    return {
        approvedScenarios: [],
        tddApproval: "REJECTED",
        redValidation: {
            status: "blocked",
            reasons: ["RED validation proof is required before implementation"],
        },
        checkpointEvidence: [],
        fixAttempts: [],
    };
}
function resolveRuntimeMode(input) {
    if (input.capabilityRuntimeMode) {
        return input.capabilityRuntimeMode;
    }
    if (!input.agentRuntime) {
        return "blocked-no-agent-runtime";
    }
    if (input.agentRuntime.runtimeMode) {
        return input.agentRuntime.runtimeMode;
    }
    if (input.explicitPipelineRequested && input.strictAgents === false) {
        return "harness";
    }
    return "real-agent";
}
async function bootstrapExplicitPipelineState(input) {
    if (!input.stateRoot) {
        return;
    }
    const now = Math.floor(Date.now() / 1000);
    writeSessionLockAtomic(sessionLockPath(input.stateRoot), buildSessionLock({
        session_id: input.sessionId,
        now,
    }));
    await input.runtime?.stores?.session?.save?.({
        sessionId: input.sessionId,
        run_id: input.runId,
        runStartedAt: new Date(now * 1000).toISOString(),
        currentPhase: "phase-0",
        phase: "phase-0",
        batchIndex: 0,
        mode: input.mode,
        variant: input.variant,
        confidenceScore: 1,
        strictAgents: input.runtime?.strictAgents,
        runtime_mode: input.runtimeMode,
        unresolvedBlockers: [],
        pendingDecision: "bootstrap",
        touchedFiles: [],
    });
    await saveSentinelState(input.runtime, {
        session_id: input.sessionId,
        run_id: input.runId,
        workflow_id: input.mode,
        created_by_runtime: true,
        runtime_mode: input.runtimeMode,
        pipelineActive: true,
        currentPhase: "phase-0",
        currentAgent: "pipeline-controller",
        expectedNext: ["pipeline-controller"],
        completedPhases: [],
        gateSummary: ["BOOTSTRAP"],
        batchState: {
            batchIndex: 0,
            status: "bootstrap",
        },
        consecutiveCorrections: 0,
        lastCheckpoint: "post_orchestrator",
    });
}
function resolveSpecIdFromSession(session) {
    const source = session.proposal?.summary ?? session.sessionId ?? session.variant ?? "spec-request";
    return deriveSpecIdFromRequest(source);
}
function requiresSpecArtifacts(variant) {
    return isSpecLifecycleVariant(variant);
}
function evaluateSpecPhaseGate(input) {
    if (!isSpecLifecycleVariant(input.variant)) {
        return undefined;
    }
    const artifactGate = validateSpecLifecycleArtifacts({
        workspaceRoot: input.workspaceRoot,
        variant: input.variant,
        specId: input.specId,
    });
    if (artifactGate.status === "blocked") {
        return {
            gate: "SPEC_ARTIFACT_MISSING",
            phase: input.phase,
            detail: `Cannot evaluate Spec ${input.phase} gates because artifacts are missing at ${artifactGate.specPath}: ${artifactGate.missingArtifacts.join(", ")}`,
            pendingDecision: "spec-artifacts-required",
        };
    }
    if (input.phase === "phase-2") {
        const contentGate = validateSpecContentReviewGate({
            specPath: artifactGate.specPath,
        });
        if (contentGate.status === "blocked") {
            return {
                gate: "SPEC_CONTENT_REVIEW_NOGO",
                phase: "phase-2",
                detail: contentGate.detail,
                pendingDecision: "spec-content-review-required",
            };
        }
        const traceabilityGate = validateSpecAcceptanceTraceability({
            specPath: artifactGate.specPath,
        });
        if (traceabilityGate.status === "blocked") {
            return {
                gate: "SPEC_AC_TRACEABILITY_GAP",
                phase: "phase-2",
                detail: `Missing spec traceability for: ${traceabilityGate.missingTraceability.join(", ")}`,
                pendingDecision: "spec-traceability-required",
            };
        }
    }
    if (input.phase === "phase-3") {
        const postImplementationGate = validateSpecPostImplementationGate({
            specPath: artifactGate.specPath,
        });
        if (postImplementationGate.status === "blocked") {
            return {
                gate: "SPEC_POST_IMPL_FAIL",
                phase: "phase-3",
                detail: postImplementationGate.detail,
                pendingDecision: "spec-post-implementation-required",
            };
        }
    }
    return undefined;
}
async function blockForSpecPhaseGate(input) {
    await persistGateAndConfidence({
        stores: {
            gateLog: input.runtime?.stores?.gateLog,
            confidence: input.runtime?.stores?.confidence,
            stateAdapter: input.runtime?.stores?.stateAdapter,
        },
    }, [
        toGateLogEntry({
            gate: input.block.gate,
            hardness: "HARD",
            phase: input.block.phase,
            decision: "block",
            detail: input.block.detail,
        }),
    ], input.session.confidenceScore ?? 1);
    await input.runtime?.stores?.session?.save?.({
        ...input.session,
        currentPhase: input.block.phase,
        phase: input.block.phase,
        unresolvedBlockers: [input.block.detail],
        pendingDecision: input.block.pendingDecision,
        touchedFiles: input.session.touchedFiles ?? input.session.proposal?.affectedFiles ?? [],
    });
    return {
        mode: input.mode,
        status: "blocked",
        phase: input.block.phase,
        blockedBy: input.block.gate,
        reason: input.block.detail,
    };
}
function resolveScenarioWorkspaceRoot(preferredRoot) {
    if (preferredRoot && existsSync(join(preferredRoot, "tests"))) {
        return preferredRoot;
    }
    return process.cwd();
}
function resolveChangedFilesFromGit(root) {
    try {
        const raw = execFileSync("git", ["status", "--porcelain"], {
            cwd: root,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        });
        return raw
            .split(/\r?\n/u)
            .map((line) => line.trimEnd())
            .filter((line) => line.length >= 4 && !line.startsWith("!!"))
            .flatMap((line) => {
            const status = line.slice(0, 2);
            if (status.includes("D")) {
                return [];
            }
            const rawPath = line.slice(3).trim();
            const nextPath = rawPath.includes(" -> ")
                ? rawPath.split(" -> ").at(-1) ?? rawPath
                : rawPath;
            return [nextPath.replace(/\\/g, "/")];
        })
            .filter((file, index, files) => files.indexOf(file) === index);
    }
    catch {
        return [];
    }
}
function createReviewOnlyNoDiffResult(input) {
    return {
        mode: input.mode,
        type: input.classification.type,
        complexity: input.classification.complexity,
        variant: input.classification.variant,
        proposal: {
            ...input.proposal,
            affectedFiles: [],
        },
        gates: input.gates,
        implementationSkipped: true,
        review: {
            status: "blocked",
            findings: [
                {
                    severity: "important",
                    summary: "No real uncommitted git diff was found, so review-only refused to fabricate a whole-diff scope.",
                },
            ],
        },
    };
}
function createComplexityGate(input) {
    const classificationChanged = input.baseClassification.type !== input.resolvedClassification.type
        || input.baseClassification.complexity !== input.resolvedClassification.complexity
        || input.baseClassification.variant !== input.resolvedClassification.variant;
    if (!classificationChanged) {
        return {
            gate: "COMPLEXITY_GATE",
            status: "passed",
            hardness: "SOFT",
            reason: `Classifier accepted ${input.resolvedClassification.type}/${input.resolvedClassification.complexity} (${input.resolvedClassification.variant}) without override.`,
            decision: "pass",
        };
    }
    return {
        gate: "COMPLEXITY_GATE",
        status: "partial",
        hardness: "SOFT",
        reason: `Mode ${input.mode} changed classifier from ${input.baseClassification.type}/${input.baseClassification.complexity} (${input.baseClassification.variant}) to ${input.resolvedClassification.type}/${input.resolvedClassification.complexity} (${input.resolvedClassification.variant}).`,
        decision: "partial",
    };
}
function createStep17RoutingGate(input) {
    const route = input.mode === "continue"
        ? "load-existing"
        : input.explicitClassification
            ? "direct-workflow-dispatch"
            : input.mode === "--no-plan"
                ? "no-plan-bypass-evaluation"
                : input.mode === "--simples"
                    ? "simple-mode-routing"
                    : "standard-classifier-routing";
    return {
        gate: "STEP_1_7_ROUTING",
        status: "passed",
        hardness: "HARD",
        reason: `Step 1.7 selected ${route} for mode ${input.mode}.`,
        decision: "pass",
    };
}
async function persistStep17RecursionGuard(input) {
    await persistGateAndConfidence(input.runtime ?? {}, [
        toGateLogEntry({
            gate: "STEP_1_7_RECURSION_GUARD",
            hardness: "CIRCUIT_BREAKER",
            phase: "phase-1",
            decision: "block",
            detail: input.detail,
        }),
    ], input.confidenceScore ?? 1);
}
function revokeExecutionApproval(input) {
    return {
        approvedScenarios: [],
        tddApproval: "REJECTED",
        redValidation: {
            status: "blocked",
            reasons: ["RED validation proof is required before implementation"],
        },
        checkpointEvidence: input?.checkpointEvidence ?? [],
        fixAttempts: input?.fixAttempts ?? [],
    };
}
function collectScenarioCandidates(root) {
    if (!existsSync(root)) {
        return [];
    }
    const entries = readdirSync(root, {
        withFileTypes: true,
    });
    return entries.flatMap((entry) => {
        const fullPath = join(root, entry.name);
        if (entry.isDirectory()) {
            return collectScenarioCandidates(fullPath);
        }
        if (!entry.isFile() || !/\.test\.ts$/i.test(entry.name)) {
            return [];
        }
        return [fullPath];
    });
}
function normalizeComparablePath(path) {
    return path
        .replace(/\\/g, "/")
        .replace(/\.(?:d\.ts|[cm]?ts|tsx|[cm]?js|jsx)$/iu, "");
}
function createScenarioCompilerOptions(cwd) {
    const defaults = {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        esModuleInterop: true,
        skipLibCheck: true,
    };
    const configPath = ts.findConfigFile(cwd, ts.sys.fileExists, "tsconfig.json");
    if (!configPath) {
        return defaults;
    }
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (configFile.error) {
        return defaults;
    }
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, cwd);
    return {
        ...defaults,
        ...parsed.options,
    };
}
function collectReferencedSourceFiles(input) {
    const sourceText = readFileSync(input.scenarioFile, "utf8");
    const sourceFile = ts.createSourceFile(input.scenarioFile, sourceText, ts.ScriptTarget.Latest, true);
    const referencedFiles = new Set();
    const appendResolvedModule = (moduleName) => {
        const resolvedModule = ts.resolveModuleName(moduleName, input.scenarioFile, input.compilerOptions, ts.sys).resolvedModule;
        if (!resolvedModule?.resolvedFileName) {
            return;
        }
        const normalizedResolvedPath = normalizeComparablePath(resolvedModule.resolvedFileName);
        const normalizedWorkspaceRoot = `${input.cwd.replace(/\\/g, "/")}/`;
        if (!normalizedResolvedPath.startsWith(normalizeComparablePath(normalizedWorkspaceRoot))) {
            return;
        }
        referencedFiles.add(normalizedResolvedPath);
    };
    const visit = (node) => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
            && node.moduleSpecifier
            && ts.isStringLiteralLike(node.moduleSpecifier)) {
            appendResolvedModule(node.moduleSpecifier.text);
        }
        if (ts.isCallExpression(node)
            && node.arguments.length === 1
            && ts.isStringLiteralLike(node.arguments[0])
            && ((ts.isIdentifier(node.expression) && node.expression.text === "require")
                || node.expression.kind === ts.SyntaxKind.ImportKeyword)) {
            appendResolvedModule(node.arguments[0].text);
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return referencedFiles;
}
function resolveApprovedScenarioFiles(affectedFiles, cwd = process.cwd()) {
    const scenarioFiles = collectScenarioCandidates(join(cwd, "tests"));
    const compilerOptions = createScenarioCompilerOptions(cwd);
    const comparableAffectedFiles = new Set(affectedFiles.map((affectedFile) => normalizeComparablePath(resolve(cwd, affectedFile))));
    const matchedScenarios = new Set();
    for (const scenarioFile of scenarioFiles) {
        const referencedFiles = collectReferencedSourceFiles({
            scenarioFile,
            cwd,
            compilerOptions,
        });
        for (const referencedFile of referencedFiles) {
            if (comparableAffectedFiles.has(referencedFile)) {
                matchedScenarios.add(scenarioFile.replace(/\\/g, "/").replace(`${cwd.replace(/\\/g, "/")}/`, ""));
                break;
            }
        }
    }
    return [...matchedScenarios].sort();
}
function approveExecutionScenarios(input) {
    const scenarioRoot = resolveScenarioWorkspaceRoot(input.cwd);
    return {
        approvedScenarios: resolveApprovedScenarioFiles(input.proposal?.affectedFiles ?? [], scenarioRoot),
        tddApproval: "REJECTED",
        redValidation: {
            status: "blocked",
            reasons: ["RED validation proof is required before implementation"],
        },
        checkpointEvidence: input.executionProof?.checkpointEvidence ?? [],
        fixAttempts: input.executionProof?.fixAttempts ?? [],
    };
}
function createRunStores(runDir, defaults = {}) {
    const stores = {
        // R6 — propagate strictAgents into the session store so every save carries
        // the value (preserves it across the resume boundary).
        session: createSessionStore(runDir, { strictAgents: defaults.strictAgents }),
        checkpoints: createCheckpointStore(runDir),
        gateLog: createGateLog(runDir),
        confidence: createConfidenceScoreStore(runDir),
        sentinel: createSentinelStateStore(runDir),
    };
    const stateAdapter = createStateAdapter({
        session: stores.session,
        checkpoints: stores.checkpoints,
        gateLog: stores.gateLog,
        confidence: stores.confidence,
        sentinel: stores.sentinel,
    });
    return { ...stores, stateAdapter };
}
function toGateLogEntry(input) {
    const registry = createGateRegistry();
    const definition = registry.get(input.gate);
    return {
        gate: input.gate,
        hardness: input.hardness ?? definition.hardness,
        phase: input.phase,
        decision: input.decision,
        decided_by: inferDecidedBy({ source: "controller" }),
        timestamp: new Date().toISOString(),
        detail: input.detail,
        confidence_impact: input.confidence_impact ?? (input.decision === "skip" ? definition.confidenceImpactOnSkip : 0),
    };
}
function pipelineGateToLogEntry(input) {
    return toGateLogEntry({
        gate: input.gate,
        hardness: "MANDATORY",
        phase: "phase-0",
        decision: input.status === "PASS" ? "pass" : input.status === "FAIL" ? "block" : "block",
        detail: input.reason,
    });
}
function getLatestGateLogEntry(entries) {
    return [...entries]
        .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
        .at(-1);
}
function isControllerRecordedGate(entry) {
    return entry.decided_by === "controller" || entry.decided_by === "resume-router";
}
function createControllerRevalidationLock(input) {
    return {
        kind: "controller-revalidation-lock",
        runDir: input.runDir,
        phase: input.phase,
        staleContext: input.staleContext,
        updatedAt: new Date().toISOString(),
    };
}
function resolveRollbackRoute(entries) {
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
    };
}
async function resolveConfidenceBase(runtime, gateLogEntries) {
    try {
        const persisted = await runtime?.stores?.confidence?.load?.();
        if (persisted && typeof persisted === "object" && typeof persisted.score === "number") {
            return persisted.score;
        }
    }
    catch (error) {
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
async function persistGateAndConfidence(runtime, entries, baseScore) {
    const confidenceModel = createConfidenceModel();
    // Post-review fix (C2 / R2 honesty): the confidence snapshot MUST be
    // computed over the union of previously persisted entries AND the new
    // entries about to be appended — not just the new slice. Otherwise the
    // intermediate snapshot saved to confidence-score.yaml mid-run loses the
    // R2 cap whenever prior emulated entries are not part of the current
    // batch. The closeout path in src/index.ts already does the union (via
    // resolveEffectiveGateLog); this brings the per-batch path in line.
    let existingEntries = [];
    try {
        if (runtime?.stores?.stateAdapter) {
            // StateAdapter exposes a loosely-typed hardness (string) but the
            // persisted data is always written via the strict-enum writer, so the
            // cast is sound for the cap calculation.
            existingEntries = (await runtime.stores.stateAdapter.listGateDecisions());
        }
        else if (runtime?.stores?.gateLog?.list) {
            existingEntries = (await runtime.stores.gateLog.list());
        }
    }
    catch {
        // Best-effort: if reading the log fails (e.g. first write of the run,
        // no file yet), fall back to the slice. The cap can only under-estimate
        // emulation, never over-estimate — never inflates the score.
        existingEntries = [];
    }
    const snapshot = confidenceModel.apply({
        baseScore,
        gates: [...existingEntries, ...entries],
    });
    // Use StateAdapter when available (preferred abstraction), fall back to raw stores
    if (runtime?.stores?.stateAdapter) {
        for (const entry of entries) {
            await runtime.stores.stateAdapter.appendGateDecision(entry);
        }
        await runtime.stores.stateAdapter.saveConfidence(snapshot);
    }
    else {
        if (runtime?.stores?.gateLog) {
            for (const entry of entries) {
                await runtime.stores.gateLog.append(entry);
            }
        }
        if (runtime?.stores?.confidence) {
            await runtime.stores.confidence.save(snapshot);
        }
    }
    return snapshot;
}
export function createPipelineController(runtime) {
    return {
        async start(input) {
            const trimmedInput = input.trim();
            const explicitPipelineRequested = isExplicitPipelineRequest(trimmedInput);
            const { mode, normalizedRequest, explicitClassification } = parseMode(input);
            const stateRoot = getStateRoot(runtime);
            const capabilityGate = explicitPipelineRequested
                ? (() => {
                    const preflightRuntimeMode = resolveRuntimeMode({
                        explicitPipelineRequested,
                        strictAgents: runtime?.strictAgents,
                        agentRuntime: runtime?.agentRuntime,
                    });
                    return evaluateCapabilities({
                        agentRuntime: runtime?.agentRuntime,
                        runtimeMode: preflightRuntimeMode,
                        stores: runtime?.stores,
                    });
                })()
                : undefined;
            const runtimeMode = resolveRuntimeMode({
                explicitPipelineRequested,
                strictAgents: runtime?.strictAgents,
                agentRuntime: runtime?.agentRuntime,
                capabilityRuntimeMode: capabilityGate?.runtime_mode,
            });
            const bootstrapState = explicitPipelineRequested && mode !== "continue"
                ? {
                    sessionId: `pipeline-${randomUUID()}`,
                    runId: randomUUID(),
                }
                : undefined;
            if (bootstrapState) {
                await bootstrapExplicitPipelineState({
                    runtime,
                    stateRoot,
                    sessionId: bootstrapState.sessionId,
                    runId: bootstrapState.runId,
                    mode,
                    variant: explicitClassification?.variant ?? "unknown",
                    request: normalizedRequest,
                    runtimeMode,
                });
            }
            if (capabilityGate?.status !== undefined && capabilityGate.status !== "PASS") {
                if (capabilityGate.gate) {
                    await persistGateAndConfidence(runtime ?? {}, [pipelineGateToLogEntry(capabilityGate.gate)], 1);
                }
                if (bootstrapState) {
                    await runtime?.stores?.session?.save?.({
                        sessionId: bootstrapState.sessionId,
                        run_id: bootstrapState.runId,
                        runStartedAt: new Date().toISOString(),
                        currentPhase: "phase-0",
                        phase: "phase-0",
                        batchIndex: 0,
                        mode,
                        variant: explicitClassification?.variant ?? "unknown",
                        confidenceScore: 1,
                        strictAgents: runtime?.strictAgents,
                        runtime_mode: runtimeMode,
                        unresolvedBlockers: [capabilityGate.gate.reason],
                        pendingDecision: "blocked-no-agent-runtime",
                        touchedFiles: [],
                    });
                }
                return {
                    ...createBlockedPipelineArtifact({
                        request: input,
                        reason: "blocked-no-agent-runtime",
                        runtime_mode: runtimeMode,
                        missing_capabilities: capabilityGate.missing_capabilities,
                        capabilityGate: capabilityGate.gate,
                    }),
                    blockedBy: "CAPABILITY_GATE",
                };
            }
            const normalizedResponse = trimmedInput.toLowerCase();
            const workflowSwitchClassification = resolveWorkflowSwitch({
                response: normalizedResponse,
            });
            if (workflowSwitchClassification) {
                const session = await runtime?.stores?.session?.load?.()
                    .then((loaded) => loaded)
                    .catch(() => undefined);
                if (session?.currentPhase === "phase-1" && session.proposal) {
                    const currentWorkflow = session.proposal.workflowSelection?.selectedWorkflow;
                    const nextClassification = resolveWorkflowSwitch({
                        response: normalizedResponse,
                        current: {
                            type: currentWorkflow?.type,
                            complexity: currentWorkflow?.complexity,
                            variant: session.proposal.variant ?? session.variant,
                        },
                    });
                    const nextMode = resolveSessionPipelineMode(session.mode, mode);
                    const nextPlanModeStatus = getPlanModeStatus(nextMode, nextClassification.complexity);
                    const nextProposal = buildProposal({
                        request: session.proposal.summary ?? normalizedRequest,
                        classification: nextClassification,
                        mode: nextMode,
                        infoGateStatus: session.proposal.infoGateStatus ?? "partial",
                        designReviewStatus: session.proposal.designReviewStatus ?? "skipped",
                        planModeStatus: nextPlanModeStatus,
                        batchSize: defaultBatchSizeForWorkflow(nextClassification),
                        validationIntent: (session.proposal.validationIntent ?? "standard"),
                    });
                    const sentinelState = await loadSentinelState(runtime);
                    const expectedToken = getExpectedSentinelToken(session);
                    if (sentinelState?.pipelineActive
                        && sentinelState.expectedNext.length > 0
                        && !sentinelState.expectedNext.includes(expectedToken)) {
                        const entry = toGateLogEntry({
                            gate: "SENTINEL_SEQUENCE_BLOCK",
                            hardness: "HARD",
                            phase: "phase-1",
                            decision: "block",
                            detail: `Sentinel blocked unexpected workflow switch. Expected one of: ${sentinelState.expectedNext.join(", ")}`,
                        });
                        await persistGateAndConfidence(runtime ?? {}, [entry], session.confidenceScore ?? 1);
                        throw new Error(`Sentinel blocked unexpected input. Expected: ${sentinelState.expectedNext.join(", ")}`);
                    }
                    await runtime?.stores?.session?.save?.({
                        ...session,
                        currentPhase: "phase-1",
                        phase: "phase-1",
                        variant: nextClassification.variant,
                        proposal: nextProposal,
                        pendingDecision: "proposal-confirmation",
                        touchedFiles: nextProposal.affectedFiles,
                    });
                    await saveSentinelState(runtime, {
                        pipelineActive: true,
                        currentPhase: "phase-1",
                        currentAgent: "pipeline-controller",
                        expectedNext: ["proposal-response"],
                        completedPhases: ["phase-0"],
                        gateSummary: ["WORKFLOW_SWITCH"],
                        batchState: {
                            batchIndex: session.batchIndex ?? 0,
                            status: "awaiting-proposal-confirmation",
                        },
                        consecutiveCorrections: sentinelState?.consecutiveCorrections ?? 0,
                        lastCheckpoint: "post_orchestrator",
                    });
                    return {
                        phase: "phase-1",
                        workflowSwitch: {
                            status: "UPDATED",
                            from: currentWorkflow?.type ?? session.variant ?? "unknown",
                            to: nextClassification.type,
                            variant: nextClassification.variant,
                        },
                        proposal: nextProposal,
                    };
                }
            }
            if (normalizedResponse === "yes" || normalizedResponse === "no" || normalizedResponse === "adjust") {
                const session = await runtime?.stores?.session?.load?.()
                    .then((loaded) => loaded)
                    .catch(() => undefined);
                const sentinelState = await loadSentinelState(runtime);
                const expectedToken = getExpectedSentinelToken(session);
                if (session?.currentPhase !== "phase-1" && session?.currentPhase !== "phase-1.5") {
                    const detail = `Received "${normalizedResponse}" but there is no pending proposal or plan gate in the active session.`;
                    await persistGateAndConfidence(runtime ?? {}, [
                        toGateLogEntry({
                            gate: "SENTINEL_SEQUENCE_BLOCK",
                            hardness: "HARD",
                            phase: "phase-1",
                            decision: "block",
                            detail,
                        }),
                    ], session?.confidenceScore ?? 1);
                    return {
                        status: "blocked",
                        blockedBy: "SENTINEL_SEQUENCE_BLOCK",
                        reason: detail,
                    };
                }
                if (sentinelState?.pipelineActive
                    && sentinelState.expectedNext.length > 0
                    && !sentinelState.expectedNext.includes(expectedToken)) {
                    const entry = toGateLogEntry({
                        gate: "SENTINEL_SEQUENCE_BLOCK",
                        hardness: "HARD",
                        phase: session?.currentPhase === "phase-1.5" ? "phase-1.5" : "phase-1",
                        decision: "block",
                        detail: `Sentinel blocked unexpected input. Expected one of: ${sentinelState.expectedNext.join(", ")}`,
                    });
                    await persistGateAndConfidence(runtime ?? {}, [entry], session?.confidenceScore ?? 1);
                    throw new Error(`Sentinel blocked unexpected input. Expected: ${sentinelState.expectedNext.join(", ")}`);
                }
                const confirmation = confirmProposal(normalizedResponse);
                // F1 — Emit a protocol event for the proposal-confirmation gate. This is
                // the only direct user interaction in the controller that doesn't pass
                // through runRole (which already persists protocol blocks). Without this
                // hook, protocol-events.jsonl never gets populated for runs that complete
                // via the controller's own confirmation path.
                if (session?.currentPhase === "phase-1" && stateRoot) {
                    try {
                        const protocolLog = createProtocolEventLog(stateRoot);
                        const gateId = `proposal-confirmation-${session.sessionId ?? "session"}`;
                        const timestamp = new Date().toISOString();
                        await protocolLog.append({
                            event_id: `gate-request-${gateId}-emitted`,
                            kind: "GATE_REQUEST",
                            protocol_version: 1,
                            status: "emitted",
                            source: "pipeline-controller",
                            timestamp,
                            payload: {
                                kind: "GATE_REQUEST",
                                gate_id: gateId,
                                protocol_version: 1,
                                source: "pipeline-controller",
                                question: "Confirm pipeline proposal?",
                                multi_select: false,
                                options: [
                                    { label: "yes", description: "approve and execute", recommended: true },
                                    { label: "no", description: "reject the proposal", recommended: false },
                                    { label: "adjust", description: "modify before executing", recommended: false },
                                ],
                            },
                        });
                        await recordProtocolGateResponse({
                            stateRoot,
                            gateId,
                            selectedLabel: normalizedResponse,
                            source: "pipeline-controller",
                            timestamp,
                            userNotes: `confirmation_status=${confirmation.status}`,
                        });
                    }
                    catch {
                        // Best-effort: never fail the pipeline because of protocol log IO.
                    }
                }
                if (session?.currentPhase === "phase-1") {
                    const planModeStatus = session.proposal?.planModeStatus;
                    if (normalizedResponse === "yes"
                        && (planModeStatus && planModeStatus !== "skipped" || shouldAdvanceLegacyPlanningSession(session))) {
                        await runtime?.stores?.session?.save?.({
                            sessionId: session.sessionId ?? `phase-1:${session.variant ?? "proposal"}`,
                            runStartedAt: session.runStartedAt ?? new Date().toISOString(),
                            currentPhase: "phase-1.5",
                            phase: "phase-1.5",
                            batchIndex: session.batchIndex ?? 0,
                            mode: session.mode ?? mode,
                            variant: session.variant ?? "proposal",
                            confidenceScore: session.confidenceScore ?? 1,
                            proposal: session.proposal,
                            unresolvedBlockers: session.unresolvedBlockers ?? [],
                            pendingDecision: "phase-1.5-approval-required",
                            touchedFiles: session.touchedFiles ?? session.proposal?.affectedFiles ?? [],
                            approvalProof: {
                                kind: "controller-managed-transition",
                                from: "phase-1",
                                to: "phase-1.5",
                            },
                            executionProof: createInitialExecutionProof(),
                        });
                        await saveSentinelState(runtime, {
                            pipelineActive: true,
                            currentPhase: "phase-1.5",
                            currentAgent: "pipeline-controller",
                            expectedNext: ["phase-1.5-response"],
                            completedPhases: ["phase-0", "phase-1"],
                            gateSummary: ["SENTINEL_CHECKPOINT"],
                            batchState: {
                                batchIndex: session.batchIndex ?? 0,
                                status: "awaiting-plan-approval",
                            },
                            consecutiveCorrections: sentinelState?.consecutiveCorrections ?? 0,
                            lastCheckpoint: "phase_0_to_1",
                        });
                        await persistGateAndConfidence(runtime ?? {}, [
                            toGateLogEntry({
                                gate: "SENTINEL_CHECKPOINT",
                                hardness: "HARD",
                                phase: "phase-1",
                                decision: "pass",
                                detail: "Sentinel recorded phase_0_to_1 transition.",
                            }),
                        ], session.confidenceScore ?? 1);
                        return {
                            phase: "phase-1.5",
                            planModeRequest: session.proposal?.planModeRequest,
                            planModeRequestBlock: session.proposal?.planModeRequestBlock,
                            implementationPlan: createImplementationPlan({
                                status: confirmation.status,
                                summary: session.proposal?.summary,
                                affectedFiles: session.proposal?.affectedFiles,
                                variant: session.proposal?.variant,
                                validationIntent: session.proposal?.validationIntent,
                                changeContract: session.proposal?.CHANGE_CONTRACT,
                            }),
                        };
                    }
                    if (normalizedResponse === "yes") {
                        await runtime?.stores?.session?.save?.({
                            sessionId: session.sessionId ?? `phase-1:${session.variant ?? "proposal"}`,
                            runStartedAt: session.runStartedAt ?? new Date().toISOString(),
                            currentPhase: "phase-2",
                            phase: "phase-2",
                            batchIndex: session.batchIndex ?? 0,
                            mode: session.mode ?? mode,
                            variant: session.variant ?? "proposal",
                            confidenceScore: session.confidenceScore ?? 1,
                            proposal: session.proposal,
                            unresolvedBlockers: session.unresolvedBlockers ?? [],
                            // F4 — distinct from "resume" (used by /pipeline continue) so the
                            // continue resolver can detect a freshly-transitioned session
                            // that has no checkpoints yet.
                            pendingDecision: "phase-2-ready",
                            touchedFiles: session.touchedFiles ?? session.proposal?.affectedFiles ?? [],
                            approvalProof: {
                                kind: "controller-managed-transition",
                                from: "phase-1",
                                to: "phase-2",
                            },
                            executionProof: createInitialExecutionProof(),
                        });
                        // F3 — mirror the phase-1→1.5 path: persist sentinel state and a
                        // SENTINEL_CHECKPOINT gate log entry. Without these, dispatch
                        // guards relying on sentinel state see stale data for light
                        // workflows transitioning straight to phase-2.
                        await saveSentinelState(runtime, {
                            pipelineActive: true,
                            currentPhase: "phase-2",
                            currentAgent: "pipeline-controller",
                            expectedNext: ["continue"],
                            completedPhases: ["phase-0", "phase-1"],
                            gateSummary: ["SENTINEL_CHECKPOINT"],
                            batchState: {
                                batchIndex: session.batchIndex ?? 0,
                                status: "execution-approved",
                            },
                            consecutiveCorrections: sentinelState?.consecutiveCorrections ?? 0,
                            lastCheckpoint: "phase_1_to_2",
                        });
                        await persistGateAndConfidence(runtime ?? {}, [
                            toGateLogEntry({
                                gate: "SENTINEL_CHECKPOINT",
                                hardness: "HARD",
                                phase: "phase-1",
                                decision: "pass",
                                detail: "Sentinel recorded phase_1_to_2 light-workflow transition.",
                            }),
                        ], session.confidenceScore ?? 1);
                    }
                    return {
                        phase: normalizedResponse === "yes" ? "phase-2" : session.currentPhase,
                        confirmation,
                    };
                }
                if (session?.currentPhase === "phase-1.5") {
                    if (!hasControllerManagedPhaseOnePointFiveTransition(session)) {
                        throw new Error("phase-1.5 session is missing controller-managed transition proof");
                    }
                    await runtime?.stores?.session?.save?.({
                        ...session,
                        currentPhase: "phase-1.5",
                        phase: "phase-1.5",
                        pendingDecision: normalizedResponse === "yes" ? undefined : "phase-1.5-reapproval-required",
                        touchedFiles: session.touchedFiles ?? session.proposal?.affectedFiles ?? [],
                        executionProof: normalizedResponse === "yes"
                            ? approveExecutionScenarios({
                                executionProof: session.executionProof,
                                proposal: session.proposal,
                                cwd: getWorkspaceRoot(runtime),
                            })
                            : revokeExecutionApproval(session.executionProof),
                    });
                    await saveSentinelState(runtime, {
                        pipelineActive: true,
                        currentPhase: "phase-1.5",
                        currentAgent: "pipeline-controller",
                        expectedNext: normalizedResponse === "yes" ? ["continue"] : ["phase-1.5-response"],
                        completedPhases: ["phase-0", "phase-1", "phase-1.5"],
                        gateSummary: ["SENTINEL_CHECKPOINT"],
                        batchState: {
                            batchIndex: session.batchIndex ?? 0,
                            status: normalizedResponse === "yes" ? "execution-approved" : "awaiting-plan-reapproval",
                        },
                        consecutiveCorrections: normalizedResponse === "adjust"
                            ? (sentinelState?.consecutiveCorrections ?? 0) + 1
                            : sentinelState?.consecutiveCorrections ?? 0,
                        lastCheckpoint: "phase_1_to_2",
                    });
                    if (normalizedResponse === "yes") {
                        await persistGateAndConfidence(runtime ?? {}, [
                            toGateLogEntry({
                                gate: "SENTINEL_CHECKPOINT",
                                hardness: "HARD",
                                phase: "phase-1.5",
                                decision: "pass",
                                detail: "Sentinel recorded phase_1_to_2 transition.",
                            }),
                        ], session.confidenceScore ?? 1);
                    }
                    return {
                        phase: session.currentPhase,
                        planModeRequest: session.proposal?.planModeRequest,
                        planModeRequestBlock: session.proposal?.planModeRequestBlock,
                        implementationPlan: createImplementationPlan({
                            status: confirmation.status,
                            summary: session.proposal?.summary,
                            affectedFiles: session.proposal?.affectedFiles,
                            variant: session.proposal?.variant,
                            validationIntent: session.proposal?.validationIntent,
                            changeContract: session.proposal?.CHANGE_CONTRACT,
                        }),
                    };
                }
            }
            if (mode === "continue") {
                if (!stateRoot) {
                    const session = (await runtime?.stores?.session?.load?.());
                    if (!session.currentPhase) {
                        throw new Error("Session is missing current phase");
                    }
                    if (session.currentPhase === "phase-1") {
                        const detail = "Cannot continue while proposal confirmation is pending";
                        await persistStep17RecursionGuard({
                            runtime,
                            detail,
                            confidenceScore: session.confidenceScore ?? 1,
                        });
                        throw new Error(detail);
                    }
                    const gateLogEntries = await runtime?.stores?.gateLog?.list?.() ?? [];
                    const pendingRollback = resolveContinueRollbackState({
                        session,
                        gateLogEntries,
                    });
                    if (pendingRollback) {
                        return {
                            mode,
                            status: "blocked",
                            blockedBy: pendingRollback.rollbackGate,
                            ...pendingRollback,
                            gateLogEntries,
                        };
                    }
                    if (session.currentPhase === "phase-1.5" && !hasControllerManagedPhaseOnePointFiveTransition(session)) {
                        throw new Error("phase-1.5 session is missing controller-managed transition proof");
                    }
                    if (session.currentPhase === "phase-1.5" && hasControllerManagedPhaseOnePointFiveTransition(session)) {
                        return executeApprovedContinuation({
                            runtime,
                            session,
                            mode,
                        });
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
                const runStores = createRunStores(runDir, { strictAgents: runtime?.strictAgents });
                const session = (await runStores.session.load());
                const controllerLockStore = createControllerLockStore(stateRoot);
                const controllerLock = await controllerLockStore.load();
                if (!session.currentPhase) {
                    throw new Error("Session is missing current phase");
                }
                if (session.currentPhase === "phase-1") {
                    const detail = "Cannot continue while proposal confirmation is pending";
                    await persistStep17RecursionGuard({
                        runtime: { stores: runStores },
                        detail,
                        confidenceScore: session.confidenceScore ?? 1,
                    });
                    throw new Error(detail);
                }
                if (session.currentPhase === "phase-1.5" && !hasControllerManagedPhaseOnePointFiveTransition(session)) {
                    throw new Error("phase-1.5 session is missing controller-managed transition proof");
                }
                if (controllerLock) {
                    const lockedRunStores = createRunStores(controllerLock.runDir, { strictAgents: runtime?.strictAgents });
                    const lockedSession = (await lockedRunStores.session.load());
                    if (lockedSession.pendingDecision === "revalidate") {
                        const gateLogEntries = await lockedRunStores.gateLog.list();
                        return {
                            mode,
                            status: "blocked",
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
                const pendingRollback = resolveContinueRollbackState({
                    session,
                    gateLogEntries,
                });
                if (pendingRollback) {
                    return {
                        mode,
                        status: "blocked",
                        blockedBy: pendingRollback.rollbackGate,
                        ...pendingRollback,
                        latestRun: runDir,
                        gateLogEntries,
                    };
                }
                const trustedGateLogEntries = gateLogEntries.filter(isControllerRecordedGate);
                const recordedStaleLock = trustedGateLogEntries.some((entry) => entry.gate === "STALE_CONTEXT" && entry.decision === "block");
                const rollbackRoute = resolveRollbackRoute(trustedGateLogEntries);
                if (recordedStaleLock) {
                    return {
                        mode,
                        status: "blocked",
                        phase: session.currentPhase,
                        resumeBlocked: true,
                        revalidationRequired: true,
                        staleContext: getLatestGateLogEntry(trustedGateLogEntries),
                        latestRun: runDir,
                        gateLogEntries,
                    };
                }
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
                        status: "blocked",
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
                const lastActivityAt = latestRun?.lastActivityAt ?? new Date().toISOString();
                const confidenceBase = await resolveConfidenceBase({ stores: runStores }, trustedGateLogEntries);
                const staleContext = assessStaleContext({
                    session,
                    lastActivityAt,
                    now: new Date(),
                });
                if (staleContext) {
                    await persistGateAndConfidence({ stores: runStores }, [staleContext], confidenceBase);
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
                        status: "blocked",
                        phase: session.currentPhase,
                        resumeBlocked: true,
                        staleContext,
                        latestRun: runDir,
                        gateLogEntries,
                    };
                }
                if (session.currentPhase === "phase-1.5" && hasControllerManagedPhaseOnePointFiveTransition(session)) {
                    return executeApprovedContinuation({
                        runtime: {
                            workspaceRoot: runtime?.workspaceRoot,
                            stores: {
                                session: runStores.session,
                                checkpoints: runStores.checkpoints,
                                gateLog: runStores.gateLog,
                                confidence: runStores.confidence,
                                stateAdapter: runStores.stateAdapter,
                            },
                            executionController: runtime?.executionController,
                        },
                        session,
                        mode,
                    });
                }
                if (session.currentPhase === "phase-2" && session.pendingDecision === "phase-2-ready") {
                    return executeApprovedContinuation({
                        runtime: {
                            workspaceRoot: runtime?.workspaceRoot,
                            stores: {
                                session: runStores.session,
                                checkpoints: runStores.checkpoints,
                                gateLog: runStores.gateLog,
                                confidence: runStores.confidence,
                                stateAdapter: runStores.stateAdapter,
                                sentinel: runStores.sentinel,
                            },
                            executionController: runtime?.executionController,
                        },
                        session,
                        mode,
                    });
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
            const baseClassification = explicitClassification ?? classifyRequest(normalizedRequest, referenceIndex);
            const classificationResult = applyClassificationOverrides(mode, baseClassification, referenceIndex);
            const complexityGate = createComplexityGate({
                mode,
                baseClassification,
                resolvedClassification: classificationResult.classification,
            });
            const step17RoutingGate = createStep17RoutingGate({
                mode,
                explicitClassification,
            });
            const infoGate = runInformationGate({
                request: normalizedRequest,
                classification: classificationResult.classification,
                knownFacts: [],
                referenceIndex,
                mode,
            });
            const designInterrogation = runDesignInterrogation({
                mode,
                request: normalizedRequest,
                complexity: classificationResult.classification.complexity,
                type: classificationResult.classification.type,
            });
            const planModeStatus = getPlanModeStatus(mode, classificationResult.classification.complexity);
            const reviewOnlyChangedFiles = mode === "review-only"
                ? resolveChangedFilesFromGit(getWorkspaceRoot(runtime))
                : [];
            const proposal = buildProposal({
                request: normalizedRequest,
                classification: classificationResult.classification,
                mode,
                infoGateStatus: infoGate.status,
                designReviewStatus: designInterrogation.status,
                planModeStatus,
                batchSize: classificationResult.profile.batchSize,
                validationIntent: classificationResult.validationIntent,
                affectedFiles: reviewOnlyChangedFiles,
                profileSummary: classificationResult.profile.summary,
            });
            const authoritativeProposal = mode === "review-only"
                ? {
                    ...proposal,
                    affectedFiles: reviewOnlyChangedFiles,
                }
                : proposal;
            const gateEntries = [
                ...(capabilityGate?.status === "PASS" ? [pipelineGateToLogEntry(capabilityGate.gate)] : []),
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
                toGateLogEntry({
                    gate: complexityGate.gate,
                    hardness: complexityGate.hardness,
                    phase: "phase-0",
                    decision: complexityGate.decision,
                    detail: complexityGate.reason,
                }),
                toGateLogEntry({
                    gate: step17RoutingGate.gate,
                    hardness: step17RoutingGate.hardness,
                    phase: "phase-1",
                    decision: step17RoutingGate.decision,
                    detail: step17RoutingGate.reason,
                }),
            ];
            const specArtifactGate = requiresSpecArtifacts(classificationResult.classification.variant)
                ? validateSpecLifecycleArtifacts({
                    workspaceRoot: getWorkspaceRoot(runtime),
                    variant: classificationResult.classification.variant,
                    specId: deriveSpecIdFromRequest(normalizedRequest),
                })
                : undefined;
            if (specArtifactGate?.status === "blocked") {
                const detail = `Missing spec artifacts at ${specArtifactGate.specPath}: ${specArtifactGate.missingArtifacts.join(", ")}`;
                const specGateEntry = toGateLogEntry({
                    gate: "SPEC_ARTIFACT_MISSING",
                    hardness: "HARD",
                    phase: "phase-1",
                    decision: "block",
                    detail,
                });
                const blockedGates = [
                    ...gateEntries,
                    specGateEntry,
                ];
                await persistGateAndConfidence(runtime ?? {}, blockedGates, 1);
                await runtime?.stores?.session?.save?.({
                    sessionId: bootstrapState?.sessionId ?? `${mode}:${normalizedRequest || "request"}`,
                    run_id: bootstrapState?.runId,
                    runStartedAt: new Date().toISOString(),
                    currentPhase: "phase-1",
                    phase: "phase-1",
                    batchIndex: 0,
                    mode,
                    variant: classificationResult.classification.variant,
                    confidenceScore: 1,
                    strictAgents: runtime?.strictAgents,
                    runtime_mode: runtimeMode,
                    proposal: {
                        ...authoritativeProposal,
                        awaitingUserConfirmation: false,
                    },
                    unresolvedBlockers: [detail],
                    pendingDecision: "spec-artifacts-required",
                    touchedFiles: authoritativeProposal.affectedFiles,
                });
                return {
                    mode,
                    status: "blocked",
                    blockedBy: "SPEC_ARTIFACT_MISSING",
                    type: classificationResult.classification.type,
                    complexity: classificationResult.classification.complexity,
                    variant: classificationResult.classification.variant,
                    proposal: authoritativeProposal,
                    gates: [
                        ...(capabilityGate?.status === "PASS" ? [capabilityGate.gate] : []),
                        infoGate,
                        designInterrogation,
                        complexityGate,
                        step17RoutingGate,
                        {
                            gate: "SPEC_ARTIFACT_MISSING",
                            status: "blocked",
                            hardness: "HARD",
                            reason: detail,
                            specPath: specArtifactGate.specPath,
                            missingArtifacts: specArtifactGate.missingArtifacts,
                        },
                    ],
                    missingArtifacts: specArtifactGate.missingArtifacts,
                    specPath: specArtifactGate.specPath,
                };
            }
            const passedSpecPath = specArtifactGate?.status === "passed"
                ? specArtifactGate.specPath
                : undefined;
            const specFormatGate = passedSpecPath
                ? validateSpecFormatGate({
                    specPath: passedSpecPath,
                })
                : undefined;
            if (specFormatGate?.status === "blocked") {
                const specGateEntry = toGateLogEntry({
                    gate: "SPEC_FORMAT_GATE_FAIL",
                    hardness: "HARD",
                    phase: "phase-1",
                    decision: "block",
                    detail: specFormatGate.detail,
                });
                const blockedGates = [
                    ...gateEntries,
                    specGateEntry,
                ];
                await persistGateAndConfidence(runtime ?? {}, blockedGates, 1);
                await runtime?.stores?.session?.save?.({
                    sessionId: bootstrapState?.sessionId ?? `${mode}:${normalizedRequest || "request"}`,
                    run_id: bootstrapState?.runId,
                    runStartedAt: new Date().toISOString(),
                    currentPhase: "phase-1",
                    phase: "phase-1",
                    batchIndex: 0,
                    mode,
                    variant: classificationResult.classification.variant,
                    confidenceScore: 1,
                    strictAgents: runtime?.strictAgents,
                    runtime_mode: runtimeMode,
                    proposal: {
                        ...authoritativeProposal,
                        awaitingUserConfirmation: false,
                    },
                    unresolvedBlockers: [specFormatGate.detail],
                    pendingDecision: "spec-format-required",
                    touchedFiles: authoritativeProposal.affectedFiles,
                });
                return {
                    mode,
                    status: "blocked",
                    blockedBy: "SPEC_FORMAT_GATE_FAIL",
                    type: classificationResult.classification.type,
                    complexity: classificationResult.classification.complexity,
                    variant: classificationResult.classification.variant,
                    proposal: authoritativeProposal,
                    gates: [
                        ...(capabilityGate?.status === "PASS" ? [capabilityGate.gate] : []),
                        infoGate,
                        designInterrogation,
                        complexityGate,
                        step17RoutingGate,
                        {
                            gate: "SPEC_FORMAT_GATE_FAIL",
                            status: "blocked",
                            hardness: "HARD",
                            reason: specFormatGate.detail,
                        },
                    ],
                    specPath: passedSpecPath,
                };
            }
            if (mode === "diagnostic") {
                await persistGateAndConfidence(runtime ?? {}, gateEntries, 1);
                return {
                    mode,
                    type: classificationResult.classification.type,
                    complexity: classificationResult.classification.complexity,
                    variant: classificationResult.classification.variant,
                    proposal: authoritativeProposal,
                    gates: [
                        ...(capabilityGate?.status === "PASS" ? [capabilityGate.gate] : []),
                        infoGate,
                        designInterrogation,
                        complexityGate,
                        step17RoutingGate,
                    ],
                    stoppedAfterProposal: true,
                };
            }
            if (mode === "review-only") {
                const changedFiles = authoritativeProposal.affectedFiles ?? [];
                if (changedFiles.length === 0) {
                    return createReviewOnlyNoDiffResult({
                        mode,
                        classification: classificationResult.classification,
                        proposal: authoritativeProposal,
                        gates: [
                            ...(capabilityGate?.status === "PASS" ? [capabilityGate.gate] : []),
                            infoGate,
                            designInterrogation,
                            complexityGate,
                            step17RoutingGate,
                        ],
                    });
                }
                const changedDomains = detectChangedDomains(changedFiles);
                const review = await getReviewOrchestrator(runtime).reviewBatch({
                    batch: {
                        name: "whole-diff-review",
                        files: changedFiles,
                    },
                    changedFiles,
                    changedDomains,
                });
                return {
                    mode,
                    type: classificationResult.classification.type,
                    complexity: classificationResult.classification.complexity,
                    variant: classificationResult.classification.variant,
                    proposal: authoritativeProposal,
                    gates: [
                        ...(capabilityGate?.status === "PASS" ? [capabilityGate.gate] : []),
                        infoGate,
                        designInterrogation,
                        complexityGate,
                        step17RoutingGate,
                    ],
                    implementationSkipped: true,
                    review,
                };
            }
            await persistGateAndConfidence(runtime ?? {}, gateEntries, 1);
            await saveSentinelState(runtime, {
                session_id: bootstrapState?.sessionId,
                run_id: bootstrapState?.runId,
                workflow_id: mode,
                created_by_runtime: true,
                runtime_mode: runtimeMode,
                pipelineActive: true,
                currentPhase: "phase-1",
                currentAgent: "pipeline-controller",
                expectedNext: ["proposal-response"],
                completedPhases: ["phase-0"],
                gateSummary: gateEntries.map((entry) => entry.gate),
                batchState: {
                    batchIndex: 0,
                    status: "awaiting-proposal-confirmation",
                },
                consecutiveCorrections: 0,
                lastCheckpoint: "post_orchestrator",
            });
            await persistGateAndConfidence(runtime ?? {}, [
                toGateLogEntry({
                    gate: "SENTINEL_CHECKPOINT",
                    hardness: "HARD",
                    phase: "phase-0",
                    decision: "pass",
                    detail: "Sentinel recorded post_orchestrator checkpoint.",
                }),
            ], 1);
            await runtime?.stores?.session?.save?.({
                sessionId: bootstrapState?.sessionId ?? `${mode}:${normalizedRequest || "request"}`,
                run_id: bootstrapState?.runId,
                runStartedAt: new Date().toISOString(),
                currentPhase: "phase-1",
                phase: "phase-1",
                batchIndex: 0,
                mode,
                variant: classificationResult.classification.variant,
                confidenceScore: 1,
                strictAgents: runtime?.strictAgents,
                runtime_mode: runtimeMode,
                proposal: {
                    ...authoritativeProposal,
                    awaitingUserConfirmation: true,
                },
                unresolvedBlockers: infoGate.status === "blocked" ? [infoGate.reason] : [],
                pendingDecision: "proposal-confirmation",
                touchedFiles: authoritativeProposal.affectedFiles,
            });
            return {
                mode,
                type: classificationResult.classification.type,
                complexity: classificationResult.classification.complexity,
                variant: classificationResult.classification.variant,
                proposal: authoritativeProposal,
                gates: [
                    ...(capabilityGate?.status === "PASS" ? [capabilityGate.gate] : []),
                    infoGate,
                    designInterrogation,
                    complexityGate,
                    step17RoutingGate,
                ],
                planModeStatus,
            };
        },
    };
}
