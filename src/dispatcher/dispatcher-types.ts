export type DispatchMode = "single-agent" | "multi-agent";
export type AuthorityLevel = "controller" | "reviewer" | "executor";

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
