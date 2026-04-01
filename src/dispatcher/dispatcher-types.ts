export type DispatchMode = "single-agent" | "multi-agent";

export interface DispatchRequest {
  mode: DispatchMode;
  role: string;
  prompt: string;
  input: Record<string, unknown>;
}

export interface DispatchResult {
  mode: DispatchMode;
  role: string;
  output: Record<string, unknown>;
}
