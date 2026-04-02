export type DispatchMode = "single-agent" | "multi-agent";

export interface DispatchRequest {
  mode: DispatchMode;
  role: string;
  prompt: string;
  input: Record<string, unknown>;
  freshContext?: boolean;
  reviewOnly?: boolean;
}

export interface DispatchResult {
  mode: DispatchMode;
  role: string;
  output: Record<string, unknown>;
}
