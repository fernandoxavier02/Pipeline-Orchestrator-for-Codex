import type { AgentRuntimeAdapter } from "../dispatcher/dispatcher-types.js";

export const PIPELINE_MODES = [
  "full",
  "diagnostic",
  "continue",
  "review-only",
  "--simples",
  "--media",
  "--complexa",
  "--plan",
  "--grill",
  "--hotfix",
] as const;

export type PipelineMode = (typeof PIPELINE_MODES)[number];

export type PipelinePhase = "phase-0" | "phase-1" | "phase-1.5" | "phase-2" | "phase-3";

export type PipelineVariant =
  | "implement-light"
  | "implement-heavy"
  | "bugfix-light"
  | "bugfix-heavy"
  | "audit-light"
  | "audit-heavy"
  | "user-story-light"
  | "user-story-heavy"
  | "ux-sim-light"
  | "ux-sim-heavy";

export interface RuntimeOptions {
  cwd: string;
  codexHome: string;
  strictAgents?: boolean;
  agentRuntime?: AgentRuntimeAdapter;
}
