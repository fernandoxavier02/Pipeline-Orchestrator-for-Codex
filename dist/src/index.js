import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHmac, timingSafeEqual } from "node:crypto";
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
import { createGateLog, inferDecidedBy } from "./state/gate-log.js";
import { resolveRequireRealAgent } from "./runtime/strict-resolution.js";
import { createCodexAgentRuntimeAdapter, detectCodexAgentRuntime, } from "./adapters/codex-agent-runtime.js";
import { validatePipelineArtifact, } from "./governance/pipeline-contract.js";
import { validatePipelineLedgerEvidence } from "./governance/ledger-evidence.js";
import { resolveSentinelIntegrityHmacKey } from "./security/ledger-integrity.js";
import { createSessionStore } from "./state/session-store.js";
import { createSentinelStateStore } from "./sentinel/sentinel-state.js";
import { writeTrace } from "./trace/trace.js";
import { isNonExemptMode, recordPostFinalValidatorCheckpoint, resolveEffectiveGateLog, } from "./validation/final-validator.js";
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
    if (isNonExemptMode(input.mode) && input.validationIntent !== "reduced") {
        evidenceKinds.add("protocol-events");
        evidenceKinds.add("gate-decisions");
        evidenceKinds.add("target-latest-trace");
    }
    return evidenceKinds;
}
export function collectCanonicalArtifactEvidence(input) {
    const protocolEventsPath = join(input.stateDir, "protocol-events.jsonl");
    const gateDecisionsPath = join(input.stateDir, "gate-decisions.jsonl");
    const latestTracePath = join(input.workspaceRoot, "evals", "telemetry", "latest_trace.json");
    const hasNonEmptyFile = (path) => {
        try {
            // lstatSync does NOT follow symlinks — refuse symlinked evidence to
            // prevent forgery via planted symlinks pointing at unrelated non-empty files.
            const stats = lstatSync(path);
            if (stats.isSymbolicLink())
                return false;
            return stats.isFile() && stats.size > 0;
        }
        catch {
            return false;
        }
    };
    return [
        {
            kind: "protocol-events",
            passed: hasNonEmptyFile(protocolEventsPath),
            label: "target .codex/pipeline/protocol-events.jsonl",
        },
        {
            kind: "gate-decisions",
            passed: hasNonEmptyFile(gateDecisionsPath),
            label: "target .codex/pipeline/gate-decisions.jsonl",
        },
        {
            kind: "target-latest-trace",
            passed: hasNonEmptyFile(latestTracePath),
            label: "target evals/telemetry/latest_trace.json",
        },
    ];
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
const HMAC_SHA256_HEX_SIGNATURE = /^[0-9a-f]{64}$/iu;
function canonicalizeIntegrityPayload(value) {
    if (Array.isArray(value)) {
        return `[${value.map((entry) => canonicalizeIntegrityPayload(entry)).join(",")}]`;
    }
    if (value && typeof value === "object") {
        const entries = Object.entries(value)
            .filter(([, entry]) => entry !== undefined)
            .sort(([left], [right]) => left.localeCompare(right));
        return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalizeIntegrityPayload(entry)}`).join(",")}}`;
    }
    return JSON.stringify(value);
}
function sentinelIntegrityVerified(stateDir) {
    const key = resolveSentinelIntegrityHmacKey();
    if (!key)
        return true;
    const sentinel = readJsonFile(join(stateDir, "sentinel-state.json"));
    if (!sentinel || typeof sentinel !== "object" || Array.isArray(sentinel))
        return false;
    const integrity = sentinel._integrity;
    if (!integrity || typeof integrity !== "object" || Array.isArray(integrity))
        return false;
    const algorithm = integrity.algorithm;
    const signature = integrity.signature;
    if (algorithm !== "hmac-sha256"
        || typeof signature !== "string"
        || !HMAC_SHA256_HEX_SIGNATURE.test(signature)) {
        return false;
    }
    const unsignedState = { ...sentinel };
    delete unsignedState._integrity;
    const expected = createHmac("sha256", key).update(canonicalizeIntegrityPayload(unsignedState)).digest("hex");
    const expectedBytes = Buffer.from(expected, "hex");
    const actualBytes = Buffer.from(signature, "hex");
    return actualBytes.length > 0
        && expectedBytes.length === actualBytes.length
        && timingSafeEqual(expectedBytes, actualBytes);
}
function containsPipelineCompletion(text) {
    return /\bPIPELINE COMPLETE\b/u.test(text)
        || /\b(?:PIPELINE[\s_-]*STATUS|FINAL[\s_-]*(?:REVIEW|ADVERSARIAL[\s_-]*(?:REPORT|REVIEW)|REPORT|VERDICT|DECISION)|FINAL[\s_-]*ADVERSARIAL|ADVERSARIAL[\s_-]*(?:REPORT|REVIEW)|VERDICT|GO\/NO-GO|REVIEW[\s_-]*VERDICT)(?:\s*(?::|=|-|\bis\b|\best[áa]\b)\s*|\s+)(?:GO|NO-GO|CONDITIONAL|PASS|CLEAN|APPROVED)\b/iu.test(text)
        || /\bno blocking issues remain\b/iu.test(text)
        || /\bno\s+P0\/P1\/P2\s+(?:remain|remaining)\b/iu.test(text)
        || /\bsem\s+P0\/P1\/P2\b/iu.test(text)
        || /\bFinal decision:\s*(?:GO|CONDITIONAL)\b/iu.test(text)
        || /["']?pipeline_valid["']?\s*[:=]\s*true\b/iu.test(text);
}
function outputAttemptsPipelineCompletion(output) {
    if (containsPipelineCompletion(dispatchOutputText(output))) {
        return true;
    }
    if (output.pipeline_valid === true || output.pipelineValid === true) {
        return true;
    }
    return output.pipelineGovernanceArtifact !== undefined
        || output.governanceArtifact !== undefined
        || output.pipeline_governance_artifact !== undefined;
}
function hasNonEmptyRegularFile(path) {
    try {
        const stats = lstatSync(path);
        return !stats.isSymbolicLink() && stats.isFile() && stats.size > 0;
    }
    catch {
        return false;
    }
}
function readJsonlFile(path) {
    try {
        const stats = lstatSync(path);
        if (stats.isSymbolicLink() || !stats.isFile() || stats.size === 0) {
            return [];
        }
        return readFileSync(path, "utf8")
            .split("\n")
            .filter((line) => line.trim().length > 0)
            .flatMap((line) => {
            try {
                return [JSON.parse(line)];
            }
            catch {
                return [];
            }
        });
    }
    catch {
        return [];
    }
}
function readJsonFile(path) {
    try {
        const stats = lstatSync(path);
        if (stats.isSymbolicLink() || !stats.isFile() || stats.size === 0) {
            return undefined;
        }
        return JSON.parse(readFileSync(path, "utf8"));
    }
    catch {
        return undefined;
    }
}
function readCheckpointLedger(stateDir) {
    const checkpointDir = join(stateDir, "checkpoints");
    try {
        return readdirSync(checkpointDir, { withFileTypes: true })
            .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
            .flatMap((entry) => {
            try {
                return [JSON.parse(readFileSync(join(checkpointDir, entry.name), "utf8"))];
            }
            catch {
                return [];
            }
        });
    }
    catch {
        return [];
    }
}
const STRONG_ACTIVE_IDENTITY_KEYS = new Set([
    "run_id",
    "runId",
    "session_id",
    "sessionId",
    "trace_id",
    "traceId",
]);
const WEAK_ACTIVE_IDENTITY_KEYS = new Set([
    "workflow_id",
    "workflowId",
]);
const ACTIVE_IDENTITY_ALIASES = new Map([
    ["run_id", "run"],
    ["runId", "run"],
    ["session_id", "session"],
    ["sessionId", "session"],
    ["trace_id", "trace"],
    ["traceId", "trace"],
    ["workflow_id", "workflow"],
    ["workflowId", "workflow"],
]);
const PRIMARY_STRONG_ACTIVE_IDENTITY_DIMENSIONS = ["run", "session"];
function canonicalActiveIdentityKey(key) {
    return ACTIVE_IDENTITY_ALIASES.get(key) ?? key;
}
function addActiveIdentityValue(result, key, value) {
    if (typeof value !== "string" && typeof value !== "number")
        return;
    const normalized = String(value).trim();
    if (normalized.length === 0)
        return;
    const canonicalKey = canonicalActiveIdentityKey(key);
    const values = result.get(canonicalKey) ?? new Set();
    values.add(normalized);
    result.set(canonicalKey, values);
}
function collectDirectActiveIdentityMap(value, keys) {
    const result = new Map();
    if (!value || typeof value !== "object" || Array.isArray(value))
        return result;
    for (const [key, entry] of Object.entries(value)) {
        if (!keys.has(key))
            continue;
        addActiveIdentityValue(result, key, entry);
    }
    return result;
}
function collectActiveIdentityMap(value, depth = 0, keys) {
    const result = new Map();
    if (depth > 8 || value === undefined || value === null)
        return result;
    if (Array.isArray(value)) {
        return mergeActiveIdentityMaps(...value.map((entry) => collectActiveIdentityMap(entry, depth + 1, keys)));
    }
    if (typeof value !== "object")
        return result;
    for (const [key, entry] of Object.entries(value)) {
        const nested = collectActiveIdentityMap(entry, depth + 1, keys);
        for (const [nestedKey, nestedValues] of nested.entries()) {
            const values = result.get(nestedKey) ?? new Set();
            for (const nestedValue of nestedValues)
                values.add(nestedValue);
            result.set(nestedKey, values);
        }
        if (keys.has(key))
            addActiveIdentityValue(result, key, entry);
    }
    return result;
}
function valuesFromActiveIdentityMap(identityMap) {
    return [...new Set([...identityMap.values()].flatMap((values) => [...values]))];
}
function activeIdentityMapsConflict(leftMap, rightMap) {
    for (const [key, leftValues] of leftMap.entries()) {
        const rightValues = rightMap.get(key);
        if (!rightValues || rightValues.size === 0)
            continue;
        if (leftValues.size !== rightValues.size)
            return true;
        if ([...leftValues].some((value) => !rightValues.has(value)))
            return true;
    }
    return false;
}
function activeIdentityMapsHaveSameKeys(leftMap, rightMap) {
    if (leftMap.size !== rightMap.size)
        return false;
    return [...leftMap.keys()].every((key) => {
        const rightValues = rightMap.get(key);
        return rightValues && rightValues.size > 0;
    });
}
function mergeActiveIdentityMaps(...identityMaps) {
    const result = new Map();
    for (const identityMap of identityMaps) {
        for (const [key, values] of identityMap.entries()) {
            const existing = result.get(key) ?? new Set();
            for (const value of values)
                existing.add(value);
            result.set(key, existing);
        }
    }
    return result;
}
function activeRunIdentityContext(stateDir) {
    const sentinel = readJsonFile(join(stateDir, "sentinel-state.json"));
    const session = readJsonFile(join(stateDir, "session.json"));
    const sentinelStrongMap = collectDirectActiveIdentityMap(sentinel, STRONG_ACTIVE_IDENTITY_KEYS);
    const sessionStrongMap = collectDirectActiveIdentityMap(session, STRONG_ACTIVE_IDENTITY_KEYS);
    const sentinelStrongIds = valuesFromActiveIdentityMap(sentinelStrongMap);
    const sessionStrongIds = valuesFromActiveIdentityMap(sessionStrongMap);
    if (sentinelStrongIds.length > 0 && sessionStrongIds.length > 0) {
        if (!activeIdentityMapsHaveSameKeys(sentinelStrongMap, sessionStrongMap)
            || activeIdentityMapsConflict(sentinelStrongMap, sessionStrongMap)) {
            return {
                ids: [],
                map: new Map(),
                keys: STRONG_ACTIVE_IDENTITY_KEYS,
                conflict: true,
            };
        }
        const strongMap = mergeActiveIdentityMaps(sentinelStrongMap, sessionStrongMap);
        return {
            ids: valuesFromActiveIdentityMap(strongMap),
            map: strongMap,
            keys: STRONG_ACTIVE_IDENTITY_KEYS,
        };
    }
    if (sentinelStrongIds.length > 0) {
        return {
            ids: sentinelStrongIds,
            map: sentinelStrongMap,
            keys: STRONG_ACTIVE_IDENTITY_KEYS,
        };
    }
    if (sessionStrongIds.length > 0) {
        return {
            ids: sessionStrongIds,
            map: sessionStrongMap,
            keys: STRONG_ACTIVE_IDENTITY_KEYS,
        };
    }
    const sentinelWeakMap = collectDirectActiveIdentityMap(sentinel, WEAK_ACTIVE_IDENTITY_KEYS);
    const sentinelWeakIds = valuesFromActiveIdentityMap(sentinelWeakMap);
    if (sentinelWeakIds.length > 0) {
        return {
            ids: sentinelWeakIds,
            map: sentinelWeakMap,
            keys: WEAK_ACTIVE_IDENTITY_KEYS,
        };
    }
    const sessionWeakMap = collectDirectActiveIdentityMap(session, WEAK_ACTIVE_IDENTITY_KEYS);
    return {
        ids: valuesFromActiveIdentityMap(sessionWeakMap),
        map: sessionWeakMap,
        keys: WEAK_ACTIVE_IDENTITY_KEYS,
    };
}
function activeIdentityHasPrimaryStrongIdentity(identityContext) {
    return PRIMARY_STRONG_ACTIVE_IDENTITY_DIMENSIONS.some((key) => {
        const values = identityContext.map.get(key);
        return values && values.size > 0;
    });
}
function activeIdentityHasUnprovenPrimaryIdentity(artifactMap, identityContext) {
    return PRIMARY_STRONG_ACTIVE_IDENTITY_DIMENSIONS.some((key) => {
        const artifactValues = artifactMap.get(key);
        return artifactValues && artifactValues.size > 0 && !identityContext.map.has(key);
    });
}
function artifactMatchesActiveRunIdentity(artifact, identityContext) {
    if (identityContext.conflict)
        return false;
    if (identityContext.ids.length === 0)
        return true;
    if (!activeIdentityHasPrimaryStrongIdentity(identityContext))
        return false;
    const artifactMap = collectActiveIdentityMap(artifact, 0, identityContext.keys);
    if (activeIdentityHasUnprovenPrimaryIdentity(artifactMap, identityContext))
        return false;
    for (const [key, activeValues] of identityContext.map.entries()) {
        const artifactValues = artifactMap.get(key);
        if (!artifactValues || artifactValues.size === 0)
            return false;
        if ([...artifactValues].some((value) => !activeValues.has(value)))
            return false;
    }
    return true;
}
function validatePipelineCompletionEvidence(input) {
    const missing = [];
    if (!hasNonEmptyRegularFile(join(input.stateDir, "protocol-events.jsonl"))) {
        missing.push("protocol-events.jsonl");
    }
    if (!hasNonEmptyRegularFile(join(input.stateDir, "gate-decisions.jsonl"))) {
        missing.push("gate-decisions.jsonl");
    }
    if (!hasNonEmptyRegularFile(join(input.stateDir, "hook-events.jsonl"))) {
        missing.push("hook-events.jsonl");
    }
    if (input.runtimeMode !== "real-agent") {
        missing.push(`runtime_mode:${input.runtimeMode ?? "missing"}`);
    }
    if (!sentinelIntegrityVerified(input.stateDir)) {
        missing.push("sentinel_integrity:hmac-sha256");
    }
    const artifact = input.output.pipelineGovernanceArtifact
        ?? input.output.governanceArtifact
        ?? input.output.pipeline_governance_artifact;
    const artifactValidation = artifact && typeof artifact === "object"
        ? validatePipelineArtifact(artifact, { adversarial: true })
        : undefined;
    if (artifactValidation?.pipeline_valid !== true) {
        missing.push("PipelineGovernanceArtifact");
        if (artifactValidation) {
            missing.push(...artifactValidation.missing_gates.map((gate) => `gate:${gate}`), ...artifactValidation.missing_hooks.map((hook) => `hook:${hook}`), ...artifactValidation.missing_agents.map((agent) => `agent:${agent}`));
        }
    }
    else {
        const activeIdentity = activeRunIdentityContext(input.stateDir);
        if (!artifactMatchesActiveRunIdentity(artifact, activeIdentity)) {
            missing.push("current_run_identity");
        }
        const ledgerValidation = validatePipelineLedgerEvidence(artifact, {
            protocolEvents: readJsonlFile(join(input.stateDir, "protocol-events.jsonl")),
            gateDecisions: readJsonlFile(join(input.stateDir, "gate-decisions.jsonl")),
            hookEvents: readJsonlFile(join(input.stateDir, "hook-events.jsonl")),
            checkpoints: readCheckpointLedger(input.stateDir),
        });
        if (ledgerValidation.status !== "PASS") {
            missing.push(...ledgerValidation.missing_evidence);
        }
    }
    return {
        ok: missing.length === 0,
        missing,
    };
}
// R3 — `isOperationalPipelineDispatch` is now exported from src/runtime/strict-resolution.ts
// (single authority for the requireRealAgent cascade — DI-3). Re-import here to
// preserve the existing call sites without renaming.
import { isOperationalPipelineDispatch } from "./runtime/strict-resolution.js";
function isBrainstormInteractiveRole(role) {
    return role === "brainstorm-controller"
        || role.endsWith(":core:brainstorm-controller")
        || role === "step-01-explore"
        || role.endsWith(":brainstorm:step-01-explore")
        || role === "step-01b-alternatives"
        || role.endsWith(":brainstorm:step-01b-alternatives");
}
function isBrainstormInteractiveGateId(gateId) {
    return /brainstorm-(?:explore-(?:q\d+|no-gaps)|alternatives-choice)/u.test(gateId);
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
    return /(?:^|\n)GATE_RESPONSES:\s*\n[\s\S]*brainstorm-(?:explore-(?:q\d+|no-gaps)|alternatives-choice)\b/u.test(prompt);
}
async function stateCarriesAnsweredBrainstormGate(stateDir) {
    try {
        const raw = await readFile(join(stateDir, "protocol-events.jsonl"), "utf8");
        return raw.split(/\r?\n/u).some((line) => (line.includes("\"status\":\"answered\"")
            && isBrainstormInteractiveGateId(line)));
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
// R7 + ARCH-004 — pure helper that resolves the effective RuntimeOptions
// (adapter auto-detection + strictAgents defaulting). Exported so tests and
// future callers can probe the bootstrap logic without instantiating the
// full runtime. Never mutates its input.
export function resolveRuntimeOptions(input) {
    if (input.agentRuntime) {
        return input;
    }
    const detected = detectCodexAgentRuntime();
    if (!detected) {
        return input;
    }
    const next = {
        ...input,
        agentRuntime: createCodexAgentRuntimeAdapter(detected),
        strictAgents: input.strictAgents ?? true,
    };
    if (input.strictAgents === false) {
        // eslint-disable-next-line no-console
        console.warn("[trust-restoration] Codex adapter detected but strictAgents=false; emulation path active.");
    }
    return next;
}
export function createPipelineRuntime(options) {
    // Post-review fix (ARCH-004): adapter detection extracted to a pure
    // resolveRuntimeOptions helper so the factory body does not mutate its
    // parameter in-place. Same semantics, but the caller's reference is now
    // guaranteed to be untouched and the bootstrap logic is testable in
    // isolation.
    options = resolveRuntimeOptions(options);
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
    // R6 — propagate strictAgents into the session store so it persists.
    const sessionStore = createSessionStore(stateDir, { strictAgents: options.strictAgents });
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
        const activeAgentRuntime = request.agentRuntime ?? options.agentRuntime;
        const result = await runRole({
            ...request,
            requireRealAgent: resolveRequireRealAgent(options, request),
            agentRuntime: activeAgentRuntime,
            prompt,
            team,
        });
        // R5 AC 5.3/5.4 — tag persisted DISPATCH_REQUEST events with the actual
        // runtime mode. An adapter object alone is not proof of real subagents.
        const runtimeDispatchMode = activeAgentRuntime?.runtimeMode === "real-agent" ? "real" : "emulated";
        const protocolBlocks = await persistProtocolBlocksFromDispatch({
            stateRoot: stateDir,
            dispatch: result,
            source: request.role,
            dispatchMode: runtimeDispatchMode,
        });
        let pendingProtocolBlocks = protocolBlocks;
        let parentDispatchResults = [];
        if (activeAgentRuntime && protocolBlocks.some((block) => block.kind === "DISPATCH_REQUEST")) {
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
                    agentRuntime: activeAgentRuntime,
                });
                return childResult.output;
            };
            const parentDispatch = await processProtocolBlocksForParent({
                stateRoot: stateDir,
                blocks: protocolBlocks.filter((block) => block.kind === "DISPATCH_REQUEST"),
                source: "runtime-parent-handler",
                dispatchMode: runtimeDispatchMode,
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
                        "The parent must collect GATE_RESPONSES for brainstorm-explore-* or brainstorm-alternatives-choice before synthesis, spec, report, plan, or handoff.",
                    ].join("\n"),
                    attemptedOutputText,
                    status: "blocked",
                    protocolStatus: "blocked-missing-brainstorm-gate",
                    blockedReason: "missing answered brainstorm GATE_REQUEST",
                },
            };
        }
        if (pendingProtocolBlocks.length === 0) {
            const attemptedOutputText = dispatchOutputText(result.output);
            if (isOperationalPipelineDispatch(request) && outputAttemptsPipelineCompletion(result.output)) {
                const completionEvidence = validatePipelineCompletionEvidence({
                    stateDir,
                    output: result.output,
                    runtimeMode: activeAgentRuntime?.runtimeMode,
                });
                if (!completionEvidence.ok) {
                    return {
                        ...result,
                        output: {
                            ...result.output,
                            text: [
                                "BLOCKED: pipeline attempted textual completion without validated governance evidence.",
                                `Missing evidence: ${completionEvidence.missing.join(", ")}`,
                            ].join("\n"),
                            attemptedOutputText,
                            status: "blocked",
                            protocolStatus: "blocked-missing-governance-evidence",
                            blockedReason: `missing ${completionEvidence.missing.join(", ")}`,
                            pipeline_valid: false,
                            manual_fallback_counts_as_pipeline: false,
                        },
                    };
                }
            }
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
    // R3 AC 3.1 — Review_Orchestrator inherits the safe cascade.
    // Passes the lazy resolver instead of a stale `=== true` boolean.
    const runtimeReviewOrchestrator = createReviewOrchestrator({
        runRole: runtimeRunRole,
        requireRealAgentForRequest: (request) => resolveRequireRealAgent(options, request),
    });
    const runtimeExecutionController = createExecutorController({
        runRole: runtimeRunRole,
        adversarialReview: (input) => runAdversarialReview({
            ...input,
            reviewOrchestrator: runtimeReviewOrchestrator,
        }),
        // R3 AC 3.2 — Final_Adversarial_Orchestrator inherits the same cascade.
        finalAdversarialOrchestrator: (input) => createFinalAdversarialOrchestrator({
            runRole: runtimeRunRole,
            requireRealAgentForRequest: (request) => resolveRequireRealAgent(options, request),
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
        strictAgents: options.strictAgents,
        agentRuntime: options.agentRuntime,
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
            // R6 — closeout stores also preserve strictAgents in saves.
            session: createSessionStore(runDir, { strictAgents: options.strictAgents }),
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
                        decided_by: inferDecidedBy({ source: "controller" }),
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
                        decided_by: inferDecidedBy({ source: "controller" }),
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
                        decided_by: entry.decided_by ?? inferDecidedBy({ source: "controller" }),
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
                const canonicalArtifactEvidence = isNonExemptMode(input.mode)
                    ? collectCanonicalArtifactEvidence({
                        workspaceRoot: options.cwd,
                        stateDir,
                    })
                    : [];
                const verificationEvidence = [
                    ...input.verificationEvidence,
                    ...canonicalArtifactEvidence,
                ].map((evidence) => ({
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
                    dispatchMode: isNonExemptMode(input.mode)
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
                let validation = parseFinalValidatorResult(finalValidatorDispatch && typeof finalValidatorDispatch === "object" && "output" in finalValidatorDispatch
                    ? finalValidatorDispatch.output
                    : undefined);
                if (!validation) {
                    throw new Error("final-validator returned an invalid runtime result");
                }
                let closeoutGateLog = effectiveGateLog;
                if (validation.decision === "NO-GO") {
                    const stopBeforePaDeCalEntry = {
                        gate: "STOP_BEFORE_PA_DE_CAL",
                        hardness: gateRegistry.get("STOP_BEFORE_PA_DE_CAL").hardness,
                        phase: "phase-3",
                        decision: "block",
                        decided_by: inferDecidedBy({ source: "controller" }),
                        timestamp: new Date().toISOString(),
                        detail: `Final validator returned NO-GO before PA_DE_CAL. Missing evidence: ${validation.missingEvidence.join(", ") || "none"}.`,
                        confidence_impact: 0,
                    };
                    await closeoutStores.gateLog.append(stopBeforePaDeCalEntry);
                    closeoutGateLog = resolveEffectiveGateLog([
                        ...effectiveGateLog,
                        stopBeforePaDeCalEntry,
                    ]);
                    validation = {
                        ...validation,
                        blockingGates: [...new Set([...validation.blockingGates, "STOP_BEFORE_PA_DE_CAL"])],
                        rollbackHint: validation.rollbackHint ?? gateRegistry.get("STOP_BEFORE_PA_DE_CAL").rollback,
                    };
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
                    executionLog: closeoutGateLog.map((entry) => `${entry.phase ?? "unknown"}:${entry.gate}:${entry.decision}`),
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
