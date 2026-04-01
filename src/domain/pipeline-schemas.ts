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
