import type { PipelineMode } from "../domain/pipeline-types.js";
import type { PipelineComplexity } from "./classification-overrides.js";

export interface DesignInterrogation {
  kind: "DESIGN_INTERROGATION";
  status: "passed" | "partial" | "skipped";
  summary: string;
  questions: string[];
}

export function runDesignInterrogation(input: {
  mode: PipelineMode;
  request: string;
  complexity: PipelineComplexity;
}): DesignInterrogation {
  const triggered = input.mode === "--grill" || input.complexity === "COMPLEXA";

  if (!triggered) {
    return {
      kind: "DESIGN_INTERROGATION",
      status: "skipped",
      summary: "Design interrogation not required for this request.",
      questions: [],
    };
  }

  return {
    kind: "DESIGN_INTERROGATION",
    status: "partial",
    summary: `Design interrogation requested for: ${input.request}`,
    questions: ["What design trade-off should we prefer here?"],
  };
}
