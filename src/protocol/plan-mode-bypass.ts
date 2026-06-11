export type MandatoryPlanModeAgent = {
  leafName: string;
  outputMarkers: string[];
};

export const MANDATORY_PLAN_MODE_AGENTS: MandatoryPlanModeAgent[] = [
  { leafName: "plan-architect", outputMarkers: ["IMPLEMENTATION_PLAN"] },
  { leafName: "bugfix-diagnostic-agent", outputMarkers: ["DIAGNOSTIC_REPORT"] },
  { leafName: "bugfix-root-cause-analyzer", outputMarkers: ["ROOT_CAUSE_RESULT"] },
  { leafName: "audit-intake", outputMarkers: ["AUDIT_INTAKE_RESULT"] },
  { leafName: "audit-domain-analyzer", outputMarkers: ["DOMAIN_ANALYSIS", "DOMAIN_ANALYZER_RESULT"] },
  { leafName: "design-interrogator", outputMarkers: ["DESIGN_INTERROGATION"] },
  { leafName: "feature-vertical-slice-planner", outputMarkers: ["VSA_PLAN"] },
  { leafName: "step-01-explore", outputMarkers: ["ContextDiscovery", "BrainstormSynthesis"] },
  { leafName: "executor-implementer-task", outputMarkers: ["IMPLEMENTER_RESULT"] },
  { leafName: "feature-implementer", outputMarkers: ["IMPLEMENTATION_RESULT"] },
];

function targetLeafName(targetName: string) {
  const normalized = targetName.replace(/\\/g, "/");
  const parts = normalized.split(/[:/]/u).filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

export function mandatoryPlanModeAgentForTarget(targetName: string) {
  const leafName = targetLeafName(targetName);
  return MANDATORY_PLAN_MODE_AGENTS.find((agent) => agent.leafName === leafName);
}

export function outputContainsSubstantiveMarker(outputText: string, agent: MandatoryPlanModeAgent) {
  return agent.outputMarkers.some((marker) => new RegExp(`(^|\\n)\\s*${marker}\\s*:`, "u").test(outputText));
}

export function outputCarriesPlanModeRequest(outputText: string) {
  return outputText.includes("=== PLAN_MODE_REQUEST v1 ===");
}

export function promptCarriesPlanModeResults(prompt: string | undefined) {
  return typeof prompt === "string" && prompt.includes("PLAN_MODE_RESULTS");
}

export function promptCarriesPlanModeBypassRedispatch(prompt: string | undefined) {
  return typeof prompt === "string" && prompt.includes("PLAN_MODE_BYPASS_REDISPATCH");
}

export function buildPlanModeBypassRedispatchPrompt(input: {
  originalPrompt?: string;
  targetName: string;
  markers: string[];
}) {
  return [
    "PLAN_MODE_BYPASS_REDISPATCH",
    `Target: ${input.targetName}`,
    `Detected substantive output before PLAN_MODE_REQUEST/PLAN_MODE_RESULTS: ${input.markers.join(", ")}`,
    "You must emit PLAN_MODE_REQUEST v1 as Step 0 and stop with STATUS: AWAITING_PLAN_MODE_RESULTS before substantive work.",
    "",
    input.originalPrompt ?? "",
  ].join("\n");
}
