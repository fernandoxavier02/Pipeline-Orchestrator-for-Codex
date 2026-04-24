export type DispatchMode = "single-agent" | "multi-agent";
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
}

export interface AgentRuntimeAdapter {
  spawnAgent: (request: AgentDispatchRequest) => Promise<DispatchResult>;
}

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
}

export interface DispatchResult {
  mode: DispatchMode;
  role: string;
  output: Record<string, unknown>;
}
