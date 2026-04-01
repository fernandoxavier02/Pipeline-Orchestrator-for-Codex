import type { ReferenceProfileIndex } from "../references/reference-profiles.js";
import type { PipelineClassification } from "./classification-overrides.js";

const FALLBACK_VARIANTS = {
  Feature: "implement-light",
  "Bug Fix": "bugfix-heavy",
  Audit: "audit-heavy",
  "User Story": "user-story-heavy",
  "UX Simulation": "ux-sim-heavy",
} as const;

export function classifyRequest(
  request: string,
  referenceIndex?: ReferenceProfileIndex,
): PipelineClassification {
  const lower = request.toLowerCase();
  const route = (type: keyof typeof FALLBACK_VARIANTS, intensity: "light" | "heavy" = "heavy") =>
    referenceIndex
      ? referenceIndex.getPipelineProfileForRoute(type, intensity)
      : { variant: FALLBACK_VARIANTS[type], type, complexity: "COMPLEXA" as const };

  if (lower.includes("audit")) {
    return route("Audit");
  }

  if (lower.includes("fix") || lower.includes("bug")) {
    return route("Bug Fix");
  }

  if (lower.includes("story")) {
    return route("User Story");
  }

  return referenceIndex
    ? referenceIndex.getPipelineProfileForRoute("Feature", "light")
    : { variant: FALLBACK_VARIANTS.Feature, type: "Feature", complexity: "MEDIA" as const };
}
