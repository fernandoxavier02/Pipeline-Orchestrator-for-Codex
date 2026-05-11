import { z } from "zod";
const gateStatusSchema = z.enum(["passed", "blocked", "partial"]);
const designReviewStatusSchema = z.enum(["passed", "partial", "skipped"]);
const planModeStatusSchema = z.enum(["required", "optional", "skipped"]);
const validationIntentSchema = z.enum(["standard", "reduced"]);
const proposalConfirmationStatusSchema = z.enum(["APPROVED", "ADJUSTED", "REJECTED"]);
const redValidationStatusSchema = z.enum(["approved", "blocked"]);
const pipelinePhaseSchema = z.enum(["phase-0", "phase-1", "phase-1.5", "phase-2", "phase-3"]);
const gateHardnessSchema = z.enum(["MANDATORY", "HARD", "CIRCUIT_BREAKER", "SOFT"]);
const gateDecisionValueSchema = z.enum(["pass", "block", "skip", "partial"]);
const confidenceBandSchema = z.enum(["low", "medium", "high"]);
const classificationTypeSchema = z.enum(["Bug Fix", "Feature", "User Story", "Audit", "UX Simulation", "Spec"]);
const pipelineComplexitySchema = z.enum(["SIMPLES", "MEDIA", "COMPLEXA"]);
const executionIdentitySchema = z.object({
    trace_id: z.string(),
    workflow_id: z.string(),
    event_id: z.string(),
    plugin_name: z.string(),
    plugin_version: z.string(),
    runtime: z.enum(["codex", "claude-code", "unknown"]),
    surface: z.string(),
    cwd: z.string(),
    pid: z.number().int(),
    node_version: z.string(),
    timestamp: z.string(),
    session_id: z.string().optional(),
    state_root: z.string().optional(),
    plugin_root: z.string().optional(),
    source: z.string().optional(),
});
export const orchestratorDecisionSchema = z.object({
    mode: z.string(),
    type: classificationTypeSchema,
    complexity: pipelineComplexitySchema,
    variant: z.string(),
    summary: z.string(),
    affectedFiles: z.array(z.string()),
});
const workflowSelectionSchema = z.object({
    status: z.literal("awaiting-user-confirmation"),
    selectedWorkflow: z.object({
        type: classificationTypeSchema,
        complexity: pipelineComplexitySchema,
        variant: z.string(),
        label: z.string(),
        reason: z.string(),
    }),
    message: z.string(),
    question: z.string(),
    options: z.array(z.object({
        command: z.string(),
        label: z.string(),
        description: z.string(),
    })),
});
const planModeRequestSchema = z.object({
    kind: z.literal("PLAN_MODE_REQUEST"),
    protocol_version: z.literal(1),
    source: z.string().default("pipeline-controller"),
    plan_id: z.string(),
    research_scope: z.string(),
    expected_deliverables: z.array(z.string()),
});
export const proposalSchema = z.object({
    summary: z.string(),
    variant: z.string(),
    awaitingUserConfirmation: z.boolean().optional(),
    infoGateStatus: gateStatusSchema,
    designReviewStatus: designReviewStatusSchema,
    planModeStatus: planModeStatusSchema,
    affectedFiles: z.array(z.string()),
    batchSize: z.number().int().positive(),
    validationIntent: validationIntentSchema,
    workflowSelection: workflowSelectionSchema.optional(),
    planModeRequest: planModeRequestSchema.optional(),
    planModeRequestBlock: z.string().optional(),
});
export const proposalConfirmationSchema = z.object({
    kind: z.literal("PROPOSAL_CONFIRMATION"),
    status: proposalConfirmationStatusSchema,
    response: z.string(),
});
export const implementationPlanSchema = z.object({
    kind: z.literal("IMPLEMENTATION_PLAN"),
    status: proposalConfirmationStatusSchema,
    summary: z.string(),
    affectedFiles: z.array(z.string()),
    tasks: z.array(z.string()).default([]),
    risks: z.array(z.string()).default([]),
    approvalNotes: z.string().default(""),
});
export const designInterrogationSchema = z.object({
    kind: z.literal("DESIGN_INTERROGATION"),
    status: designReviewStatusSchema,
    summary: z.string(),
    questions: z.array(z.string()),
});
const controllerManagedTransitionSchema = z.object({
    kind: z.literal("controller-managed-transition"),
    from: z.literal("phase-1"),
    to: z.literal("phase-1.5"),
});
const redValidationSchema = z.object({
    status: redValidationStatusSchema,
    reasons: z.array(z.string()),
});
const checkpointEvidenceSchema = z.object({
    batchName: z.string(),
    requiredCheckpoints: z.number().int().positive(),
    verifiedCheckpoints: z.number().int().nonnegative(),
    evidence: z.array(z.string()),
});
const executionProofSchema = z.object({
    approvedScenarios: z.array(z.string()).default([]),
    tddApproval: proposalConfirmationStatusSchema.optional(),
    redValidation: redValidationSchema.optional(),
    checkpointEvidence: z.array(checkpointEvidenceSchema).default([]),
    fixAttempts: z.array(z.boolean()).default([]),
});
const closeoutEvidenceSchema = z.object({
    kind: z.string(),
    passed: z.boolean(),
    label: z.string().optional(),
});
const closeoutSummarySchema = z.object({
    decision: z.enum(["GO", "CONDITIONAL", "NO-GO"]),
    confidenceScore: z.number(),
    confidenceBand: confidenceBandSchema,
    missingEvidence: z.array(z.string()),
    blockingGates: z.array(z.string()),
    skippedSoftGates: z.array(z.string()),
    blockedReviews: z.number().int().nonnegative(),
    rollbackHint: z.string().nullable().optional(),
    verificationEvidence: z.array(closeoutEvidenceSchema),
    updatedAt: z.string(),
});
export const sessionStateSchema = z.object({
    sessionId: z.string(),
    runStartedAt: z.string().optional(),
    currentPhase: pipelinePhaseSchema,
    phase: pipelinePhaseSchema.optional(),
    batchIndex: z.number().int().nonnegative().default(0),
    mode: z.string(),
    variant: z.string(),
    confidenceScore: z.number(),
    proposal: proposalSchema.optional(),
    approvalProof: controllerManagedTransitionSchema.optional(),
    executionProof: executionProofSchema.optional(),
    closeout: closeoutSummarySchema.optional(),
    unresolvedBlockers: z.array(z.string()).default([]),
    pendingDecision: z.string().optional(),
    touchedFiles: z.array(z.string()).default([]),
    execution_identity: executionIdentitySchema.optional(),
});
export const gateDecisionSchema = z.object({
    gate: z.string(),
    hardness: gateHardnessSchema,
    phase: z.string(),
    decision: gateDecisionValueSchema,
    decided_by: z.enum(["controller", "user", "system", "resume-router"]),
    timestamp: z.string(),
    detail: z.string(),
    confidence_impact: z.number(),
    execution_identity: executionIdentitySchema.optional(),
});
export const controllerRevalidationLockSchema = z.object({
    kind: z.literal("controller-revalidation-lock"),
    runDir: z.string(),
    phase: pipelinePhaseSchema,
    staleContext: gateDecisionSchema,
    updatedAt: z.string(),
});
export const sentinelStateSchema = z.object({
    pipelineActive: z.boolean(),
    currentPhase: pipelinePhaseSchema,
    currentAgent: z.string(),
    expectedNext: z.array(z.string()).default([]),
    completedPhases: z.array(pipelinePhaseSchema).default([]),
    gateSummary: z.array(z.string()).default([]),
    batchState: z.object({
        batchIndex: z.number().int().nonnegative(),
        status: z.string(),
    }),
    consecutiveCorrections: z.number().int().nonnegative(),
    lastCheckpoint: z.enum([
        "post_orchestrator",
        "phase_0_to_1",
        "phase_1_to_2",
        "phase_2_to_3",
        "post_final_validator",
    ]),
    updatedAt: z.string(),
});
export const checkpointSchema = z.object({
    name: z.string(),
    phase: pipelinePhaseSchema,
    batchIndex: z.number().int().nonnegative(),
    status: z.enum(["pending", "completed", "failed"]),
    timestamp: z.string(),
    detail: z.string().optional(),
});
export const checkpointListSchema = z.array(checkpointSchema);
export const confidenceScoreSchema = z.object({
    score: z.number(),
    band: confidenceBandSchema,
    thresholds: z.object({
        medium: z.number(),
        high: z.number(),
    }),
    gate_penalty: z.number(),
    dimensions: z.record(z.union([z.number(), z.null()])),
    updated_at: z.string(),
});
