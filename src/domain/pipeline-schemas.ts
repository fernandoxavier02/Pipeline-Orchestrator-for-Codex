import { z } from "zod";

export const orchestratorDecisionSchema = z.object({
  mode: z.string(),
  type: z.enum(["Bug Fix", "Feature", "User Story", "Audit", "UX Simulation"]),
  complexity: z.enum(["SIMPLES", "MEDIA", "COMPLEXA"]),
  variant: z.string(),
  summary: z.string(),
  affectedFiles: z.array(z.string()),
});

export const proposalSchema = z.object({
  summary: z.string(),
  variant: z.string(),
  awaitingUserConfirmation: z.boolean(),
  affectedFiles: z.array(z.string()),
});

export const sessionStateSchema = z.object({
  sessionId: z.string(),
  currentPhase: z.enum(["phase-0", "phase-1", "phase-1.5", "phase-2", "phase-3"]),
  mode: z.string(),
  variant: z.string(),
  confidenceScore: z.number(),
});

export const gateDecisionSchema = z.object({
  gate: z.string(),
  status: z.enum(["passed", "blocked", "partial"]),
  hardness: z.enum(["MANDATORY", "HARD", "CIRCUIT_BREAKER", "SOFT"]),
  reason: z.string(),
});

export const checkpointSchema = z.object({
  name: z.string(),
  status: z.enum(["pending", "completed", "failed"]),
});

export const checkpointListSchema = z.array(checkpointSchema);

export const confidenceScoreSchema = z.object({
  score: z.number(),
});
