import type { ReferenceProfileIndex } from "../references/reference-profiles.js";
import type { PipelineClassification } from "./classification-overrides.js";

const FALLBACK_VARIANTS = {
  Feature: "implement-light",
  "Bug Fix": "bugfix-heavy",
  Audit: "audit-heavy",
  "User Story": "user-story-heavy",
  "UX Simulation": "ux-sim-heavy",
  Spec: "spec-light",
} as const;

export function classifyRequest(
  request: string,
  referenceIndex?: ReferenceProfileIndex,
): PipelineClassification {
  const lower = request.toLowerCase();
  const adversarialRequested = /\b(adversarial|threat model|security audit|red team)\b/.test(lower);
  const explicitlySimple = /\b(simple|small|tiny|quick)\b/.test(lower);
  const explicitlyComplex = /\b(complex|critical|security|boundary|platform|workflow|journey|system|cross[- ]cutting)\b/.test(lower);

  const specRequested = /\bspec\b/.test(lower);
  const specAuditOnly = specRequested && /\b(audit-only|audit only|review-only|review only)\b/.test(lower);
  const route = (type: keyof typeof FALLBACK_VARIANTS, intensity: "light" | "heavy" = "heavy") => {
    const profile = referenceIndex
      ? referenceIndex.getPipelineProfileForRoute(type, intensity)
      : { variant: FALLBACK_VARIANTS[type], type, complexity: intensity === "heavy" ? "COMPLEXA" as const : "MEDIA" as const };

    return {
      ...profile,
      routeFamily: adversarialRequested ? "adversarial" as const : "standard" as const,
      adversarialRequested,
    };
  };

  const resolveIntensity = (defaultsToHeavy: boolean) => {
    if (explicitlySimple) {
      return "light" as const;
    }

    if (explicitlyComplex) {
      return "heavy" as const;
    }

    return defaultsToHeavy ? "heavy" as const : "light" as const;
  };

  if (specAuditOnly) {
    return {
      type: "Spec",
      complexity: "MEDIA",
      variant: "spec-audit-only",
      routeFamily: adversarialRequested ? "adversarial" as const : "standard" as const,
      adversarialRequested,
    };
  }

  if (specRequested) {
    const heavy = resolveIntensity(false) === "heavy";
    return {
      type: "Spec",
      complexity: heavy ? "COMPLEXA" : "MEDIA",
      variant: heavy ? "spec-heavy" : "spec-light",
      routeFamily: adversarialRequested ? "adversarial" as const : "standard" as const,
      adversarialRequested,
    };
  }

  if (adversarialRequested || lower.includes("audit")) {
    return route("Audit", resolveIntensity(true));
  }

  if (lower.includes("fix") || lower.includes("bug")) {
    return route("Bug Fix", resolveIntensity(true));
  }

  if (lower.includes("story")) {
    return route("User Story", resolveIntensity(true));
  }

  if (lower.includes("ux") || lower.includes("journey") || lower.includes("simulation")) {
    return route("UX Simulation", resolveIntensity(true));
  }

  return route("Feature", resolveIntensity(false));
}
