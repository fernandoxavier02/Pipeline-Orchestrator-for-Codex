import type { ExecutionIdentity } from "../observability/execution-identity.js";

export type DispatchMode = "single-agent" | "parallel-emulation";
export type AuthorityLevel = "controller" | "reviewer" | "executor";
export type AgentDispatchMode = "real-agent" | "blocked-no-agent-runtime";
export type AgentDispatchPhase = "phase-0" | "phase-1" | "phase-1.5" | "phase-2" | "phase-3" | "continue";

export interface AgentDispatchRequest {
  role: string;
  phase: AgentDispatchPhase;
  prompt: string;
  input: Record<string, unknown>;
  expectedOutput: string[];
  freshContext: boolean;
  ownership: string[];
  reviewOnly: boolean;
  filesInScope: string[];
  authorityLevel: AuthorityLevel;
  executionIdentity: ExecutionIdentity;
}

export interface AgentRuntimeAdapter {
  spawnAgent: (request: AgentDispatchRequest) => Promise<DispatchResult>;
  waitAgent?: (dispatch: DispatchResult) => Promise<DispatchResult>;
  collectArtifacts?: (dispatches: DispatchResult[]) => Promise<Record<string, unknown>[]>;
  capabilities?: Partial<Record<AgentRuntimeCapability, boolean>>;
  runtimeMode?: "real-agent" | "harness" | "blocked-no-agent-runtime" | "dev-bypass";
}

export type AgentRuntimeCapability =
  | "spawnAgent"
  | "waitAgent"
  | "collectArtifacts"
  | "recordGates"
  | "recordCheckpoints"
  | "structuredFinalState";

export type DispatchOutputWithIdentity = Record<string, unknown> & {
  executionIdentity: ExecutionIdentity;
};

export interface DispatchTeamMember {
  role: string;
  prompt: string;
  input: Record<string, unknown>;
  freshContext?: boolean;
  reviewOnly?: boolean;
  filesInScope?: string[];
  authorityLevel?: AuthorityLevel;
}

export interface DispatchRequest {
  mode: DispatchMode;
  role: string;
  prompt: string;
  input: Record<string, unknown>;
  phase?: AgentDispatchPhase;
  expectedOutput?: string[];
  ownership?: string[];
  requireRealAgent?: boolean;
  agentRuntime?: AgentRuntimeAdapter;
  freshContext?: boolean;
  reviewOnly?: boolean;
  filesInScope?: string[];
  authorityLevel?: AuthorityLevel;
  team?: DispatchTeamMember[];
  /**
   * When provided, write-capable roles must have an OPEN exec-window
   * keyed by sessionId under <sessionRoot>/sessions/<sessionId>.exec-window.
   * Omit both fields to disable the edit-guard for legacy callers.
   */
  sessionRoot?: string;
  sessionId?: string;
  executionIdentity?: ExecutionIdentity;
}

export interface DispatchResult {
  mode: DispatchMode;
  role: string;
  output: Record<string, unknown>;
  executionIdentity?: ExecutionIdentity;
}

export interface RunRoleResult extends Omit<DispatchResult, "output" | "executionIdentity"> {
  output: DispatchOutputWithIdentity;
  executionIdentity: ExecutionIdentity;
}
