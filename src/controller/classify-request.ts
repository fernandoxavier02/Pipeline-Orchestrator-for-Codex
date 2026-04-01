import type { ReferenceProfileIndex } from "../references/reference-profiles.js";

const FALLBACK_VARIANTS = {
  Feature: "implement-heavy",
  "Bug Fix": "bugfix-heavy",
  Audit: "audit-heavy",
  "User Story": "user-story-heavy",
  "UX Simulation": "ux-sim-heavy",
} as const;

export function classifyRequest(
  request: string,
  referenceIndex?: ReferenceProfileIndex,
) {
  const lower = request.toLowerCase();
  const route = (type: keyof typeof FALLBACK_VARIANTS) =>
    referenceIndex
      ? referenceIndex.getPipelineProfileForRoute(type, "heavy")
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

  return route("Feature");
}
