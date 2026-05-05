import type { PipelineMode } from "../domain/pipeline-types.js";
import type { ReferenceProfileIndex, ReferencePipelineProfile } from "../references/reference-profiles.js";

export type PipelineComplexity = "SIMPLES" | "MEDIA" | "COMPLEXA";
export type ValidationIntent = "standard" | "reduced";
export type RouteFamily = "standard" | "adversarial";

export interface PipelineClassification {
  type: "Feature" | "Bug Fix" | "User Story" | "Audit" | "UX Simulation" | "Spec";
  complexity: PipelineComplexity;
  variant: string;
  routeFamily?: RouteFamily;
  adversarialRequested?: boolean;
}

export interface ClassificationOverrideResult {
  classification: PipelineClassification;
  profile: ReferencePipelineProfile | {
    variant: string;
    type: PipelineClassification["type"];
    complexity: PipelineComplexity;
    intensity: "light" | "heavy";
    batchSize: number;
    summary: string;
    checklists: string[];
  };
  validationIntent: ValidationIntent;
}

type RouteIntensity = "light" | "heavy";

const FALLBACK_PROFILE_BY_ROUTE: Record<
  PipelineClassification["type"],
  Record<RouteIntensity, ClassificationOverrideResult["profile"]>
> = {
  Feature: {
    light: {
      variant: "implement-light",
      type: "Feature",
      complexity: "MEDIA",
      intensity: "light",
      batchSize: 3,
      summary: "Feature work with low to moderate risk and a small validation surface.",
      checklists: ["business-logic", "error-handling", "input-validation"],
    },
    heavy: {
      variant: "implement-heavy",
      type: "Feature",
      complexity: "COMPLEXA",
      intensity: "heavy",
      batchSize: 1,
      summary: "Feature work that touches state, workflow, or multiple review domains.",
      checklists: ["business-logic", "data-integrity", "error-handling", "input-validation"],
    },
  },
  "Bug Fix": {
    light: {
      variant: "bugfix-light",
      type: "Bug Fix",
      complexity: "MEDIA",
      intensity: "light",
      batchSize: 2,
      summary: "Bug fix work with a limited regression surface.",
      checklists: ["business-logic", "error-handling", "input-validation"],
    },
    heavy: {
      variant: "bugfix-heavy",
      type: "Bug Fix",
      complexity: "COMPLEXA",
      intensity: "heavy",
      batchSize: 1,
      summary: "Bug fix work that needs a stronger root-cause and regression posture.",
      checklists: ["auth", "business-logic", "data-integrity", "error-handling", "input-validation"],
    },
  },
  Audit: {
    light: {
      variant: "audit-light",
      type: "Audit",
      complexity: "MEDIA",
      intensity: "light",
      batchSize: 2,
      summary: "Audit work with a narrower review surface.",
      checklists: ["business-logic", "error-handling", "injection"],
    },
    heavy: {
      variant: "audit-heavy",
      type: "Audit",
      complexity: "COMPLEXA",
      intensity: "heavy",
      batchSize: 1,
      summary: "Audit work that needs broader adversarial scrutiny.",
      checklists: ["auth", "business-logic", "crypto", "data-integrity", "error-handling", "injection"],
    },
  },
  "User Story": {
    light: {
      variant: "user-story-light",
      type: "User Story",
      complexity: "MEDIA",
      intensity: "light",
      batchSize: 3,
      summary: "User story work with moderate scope and clearer acceptance criteria.",
      checklists: ["business-logic", "error-handling", "input-validation"],
    },
    heavy: {
      variant: "user-story-heavy",
      type: "User Story",
      complexity: "COMPLEXA",
      intensity: "heavy",
      batchSize: 1,
      summary: "User story work with deeper cross-cutting change.",
      checklists: ["business-logic", "data-integrity", "error-handling", "input-validation"],
    },
  },
  "UX Simulation": {
    light: {
      variant: "ux-sim-light",
      type: "UX Simulation",
      complexity: "MEDIA",
      intensity: "light",
      batchSize: 3,
      summary: "UX simulation with a compact validation surface.",
      checklists: ["business-logic", "error-handling", "input-validation"],
    },
    heavy: {
      variant: "ux-sim-heavy",
      type: "UX Simulation",
      complexity: "COMPLEXA",
      intensity: "heavy",
      batchSize: 1,
      summary: "UX simulation with design-heavy review needs.",
      checklists: ["business-logic", "data-integrity", "error-handling", "injection", "input-validation"],
    },
  },
  Spec: {
    light: {
      variant: "spec-light",
      type: "Spec",
      complexity: "MEDIA",
      intensity: "light",
      batchSize: 2,
      summary: "Spec lifecycle flow with explicit artifact and traceability gates.",
      checklists: ["business-logic", "error-handling", "input-validation"],
    },
    heavy: {
      variant: "spec-heavy",
      type: "Spec",
      complexity: "COMPLEXA",
      intensity: "heavy",
      batchSize: 1,
      summary: "Spec lifecycle flow with explicit artifact and traceability gates.",
      checklists: ["business-logic", "data-integrity", "error-handling", "input-validation"],
    },
  },
};

function getFallbackProfile(type: PipelineClassification["type"], intensity: RouteIntensity) {
  return FALLBACK_PROFILE_BY_ROUTE[type][intensity];
}

function getProfileByVariant(variant: string) {
  for (const type of Object.values(FALLBACK_PROFILE_BY_ROUTE)) {
    for (const profile of Object.values(type)) {
      if (profile.variant === variant) {
        return profile;
      }
    }
  }

  return undefined;
}

function resolveProfile(
  referenceIndex: ReferenceProfileIndex | undefined,
  type: PipelineClassification["type"],
  intensity: RouteIntensity,
) {
  if (referenceIndex) {
    return referenceIndex.getPipelineProfileForRoute(type, intensity);
  }

  return getFallbackProfile(type, intensity);
}

export function applyClassificationOverrides(
  mode: PipelineMode,
  classification: PipelineClassification,
  referenceIndex?: ReferenceProfileIndex,
): ClassificationOverrideResult {
  const isSpecVariant = classification.variant.startsWith("spec-");
  let nextType = classification.type;
  let nextComplexity = classification.complexity;
  let intensity: RouteIntensity = classification.complexity === "COMPLEXA" ? "heavy" : "light";
  let validationIntent: ValidationIntent = "standard";

  if (mode === "--hotfix") {
    nextType = isSpecVariant ? classification.type : "Bug Fix";
    nextComplexity = "COMPLEXA";
    intensity = "heavy";
    validationIntent = "reduced";
  } else if (mode === "--complexa") {
    nextComplexity = "COMPLEXA";
    intensity = "heavy";
  } else if (mode === "--media") {
    nextComplexity = "MEDIA";
    intensity = "light";
  } else if (mode === "--simples") {
    nextComplexity = "SIMPLES";
    intensity = "light";
  }

  const specProfile = isSpecVariant
    ? {
        variant: mode === "--complexa" || classification.variant === "spec-heavy"
          ? "spec-heavy"
          : classification.variant,
        type: classification.type,
        complexity: nextComplexity,
        intensity,
        batchSize: intensity === "heavy" ? 1 : 2,
        summary: "Spec lifecycle flow with explicit artifact and traceability gates.",
        checklists: ["business-logic", "error-handling", "input-validation"],
      }
    : undefined;

  const profile =
    specProfile && referenceIndex
      ? referenceIndex.getPipelineProfileForRoute("Spec", intensity)
      : specProfile
        ? {
            ...specProfile,
            complexity: nextComplexity,
            intensity,
            batchSize: intensity === "heavy" ? 1 : 2,
          }
      : mode === "full" || mode === "diagnostic" || mode === "review-only" || mode === "continue" || mode === "--plan" || mode === "--grill"
      ? specProfile ?? (referenceIndex
        ? referenceIndex.getPipelineProfile(classification.variant)
        : getProfileByVariant(classification.variant) ?? getFallbackProfile(nextType, intensity))
      : resolveProfile(referenceIndex, nextType, intensity);

  return {
    classification: {
      type: nextType,
      complexity: nextComplexity,
      variant: profile.variant,
      routeFamily: classification.routeFamily,
      adversarialRequested: classification.adversarialRequested,
    },
    profile,
    validationIntent,
  };
}
