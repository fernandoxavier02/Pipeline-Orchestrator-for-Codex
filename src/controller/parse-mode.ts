import type { PipelineMode } from "../domain/pipeline-types.js";

export function parseMode(input: string): { mode: PipelineMode; normalizedRequest: string } {
  if (input.startsWith("/pipeline diagnostic ")) {
    return {
      mode: "diagnostic",
      normalizedRequest: input.replace("/pipeline diagnostic ", ""),
    };
  }

  if (input.startsWith("/pipeline continue")) {
    return { mode: "continue", normalizedRequest: "" };
  }

  if (input.startsWith("/pipeline review-only ")) {
    return {
      mode: "review-only",
      normalizedRequest: input.replace("/pipeline review-only ", ""),
    };
  }

  return {
    mode: "full",
    normalizedRequest: input.replace("/pipeline ", ""),
  };
}
