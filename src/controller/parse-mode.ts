import type { PipelineComplexity, PipelineMode } from "../domain/pipeline-types.js";

export interface ExplicitWorkflowClassification {
  type: "Feature" | "Bug Fix" | "User Story" | "Audit" | "UX Simulation" | "Spec";
  complexity: PipelineComplexity;
  variant: string;
}

const directWorkflowCommands: Record<string, ExplicitWorkflowClassification> = {
  "audit-light": { type: "Audit", complexity: "MEDIA", variant: "audit-light" },
  "audit-heavy": { type: "Audit", complexity: "COMPLEXA", variant: "audit-heavy" },
  "bugfix-light": { type: "Bug Fix", complexity: "MEDIA", variant: "bugfix-light" },
  "bugfix-heavy": { type: "Bug Fix", complexity: "COMPLEXA", variant: "bugfix-heavy" },
  "feature-light": { type: "Feature", complexity: "MEDIA", variant: "feature-light" },
  "feature-heavy": { type: "Feature", complexity: "COMPLEXA", variant: "feature-heavy" },
  "user-story-light": { type: "User Story", complexity: "MEDIA", variant: "user-story-light" },
  "user-story-heavy": { type: "User Story", complexity: "COMPLEXA", variant: "user-story-heavy" },
  "ux-sim-light": { type: "UX Simulation", complexity: "MEDIA", variant: "ux-sim-light" },
  "ux-sim-heavy": { type: "UX Simulation", complexity: "COMPLEXA", variant: "ux-sim-heavy" },
  "spec-light": { type: "Spec", complexity: "MEDIA", variant: "spec-light" },
  "spec-heavy": { type: "Spec", complexity: "COMPLEXA", variant: "spec-heavy" },
  "spec-audit-only": { type: "Spec", complexity: "MEDIA", variant: "spec-audit-only" },
};

const workflowCommandDefaults: Record<string, { light: string; heavy: string; defaultVariant: string }> = {
  audit: { light: "audit-light", heavy: "audit-heavy", defaultVariant: "audit-heavy" },
  bugfix: { light: "bugfix-light", heavy: "bugfix-heavy", defaultVariant: "bugfix-heavy" },
  feature: { light: "feature-light", heavy: "feature-heavy", defaultVariant: "feature-light" },
  "user-story": { light: "user-story-light", heavy: "user-story-heavy", defaultVariant: "user-story-heavy" },
  "ux-sim": { light: "ux-sim-light", heavy: "ux-sim-heavy", defaultVariant: "ux-sim-heavy" },
  spec: { light: "spec-light", heavy: "spec-heavy", defaultVariant: "spec-light" },
};

const paperclipWorkflowCommandDefaults: Record<string, { light: string; heavy: string; defaultVariant: string }> = {
  "paperclip-audit": { light: "audit-light", heavy: "audit-heavy", defaultVariant: "audit-heavy" },
  "paperclip-bugfix": { light: "bugfix-light", heavy: "bugfix-heavy", defaultVariant: "bugfix-heavy" },
  "paperclip-feature": { light: "feature-light", heavy: "feature-heavy", defaultVariant: "feature-light" },
  "paperclip-spec": { light: "spec-light", heavy: "spec-heavy", defaultVariant: "spec-light" },
  "paperclip-user-story": { light: "user-story-light", heavy: "user-story-heavy", defaultVariant: "user-story-heavy" },
  "paperclip-ux": { light: "ux-sim-light", heavy: "ux-sim-heavy", defaultVariant: "ux-sim-heavy" },
  "setup-paperclip": { light: "feature-light", heavy: "feature-heavy", defaultVariant: "feature-heavy" },
};

function consumeLeadingFlag(request: string) {
  const trimmed = request.trimStart();
  const match = trimmed.match(/^--([a-z-]+)(?:\s+|$)/u);
  if (!match) {
    return { flag: undefined, request: trimmed };
  }

  return {
    flag: match[1],
    request: trimmed.slice(match[0].length).trimStart(),
  };
}

function parseDirectWorkflowCommand(input: string) {
  const directCommandMatch = input.match(/^\/pipeline-orchestrator-for-codex:([a-z-]+)(?:\s+([\s\S]*))?$/u);
  const barePaperclipMatch = input.match(/^(paperclip-audit|paperclip-bugfix|paperclip-feature|paperclip-hotfix|paperclip-review|paperclip-spec|paperclip-user-story|paperclip-ux|setup-paperclip)(?:\s+([\s\S]*))?$/u);
  const match = directCommandMatch ?? barePaperclipMatch;
  if (!match) {
    return undefined;
  }

  const command = match[1];
  const rawRequest = match[2] ?? "";

  if (command === "paperclip-hotfix") {
    return {
      mode: "--hotfix" as const,
      normalizedRequest: rawRequest.trimStart(),
      explicitClassification: directWorkflowCommands["bugfix-heavy"],
    };
  }

  if (command === "paperclip-review") {
    return {
      mode: "review-only" as const,
      normalizedRequest: rawRequest.trimStart(),
    };
  }

  if (command === "review") {
    return {
      mode: "review-only" as const,
      normalizedRequest: rawRequest.trimStart(),
    };
  }

  const direct = directWorkflowCommands[command];
  if (direct) {
    return {
      mode: "full" as const,
      normalizedRequest: rawRequest.trimStart(),
      explicitClassification: direct,
    };
  }

  const workflowDefault = workflowCommandDefaults[command] ?? paperclipWorkflowCommandDefaults[command];
  if (!workflowDefault) {
    return undefined;
  }

  const { flag, request } = consumeLeadingFlag(rawRequest);
  if (command === "paperclip-audit" && flag === "simples") {
    return {
      mode: "diagnostic" as const,
      normalizedRequest: request,
    };
  }

  const variant = flag === "light" || flag === "simples" || flag === "media"
    ? workflowDefault.light
    : flag === "heavy" || flag === "complexa"
      ? workflowDefault.heavy
      : flag === "audit-only" && command === "spec"
        ? "spec-audit-only"
        : workflowDefault.defaultVariant;
  const explicitClassification = directWorkflowCommands[variant];

  return {
    mode: "full" as const,
    normalizedRequest: request,
    explicitClassification,
  };
}

export function parseMode(input: string): {
  mode: PipelineMode;
  normalizedRequest: string;
  explicitClassification?: ExplicitWorkflowClassification;
} {
  const trimmedInput = input.trim();
  const publicCommand = "/pipeline-orchestrator-for-codex:pipeline";
  const directWorkflow = parseDirectWorkflowCommand(trimmedInput);
  if (directWorkflow) {
    return directWorkflow;
  }

  const prefixes: Array<{ prefix: string; mode: PipelineMode }> = [
    { prefix: `${publicCommand} diagnostic `, mode: "diagnostic" },
    { prefix: `${publicCommand} continue`, mode: "continue" },
    { prefix: `${publicCommand} review-only `, mode: "review-only" },
    { prefix: `${publicCommand} --simples `, mode: "--simples" },
    { prefix: `${publicCommand} --media `, mode: "--media" },
    { prefix: `${publicCommand} --complexa `, mode: "--complexa" },
    { prefix: `${publicCommand} --plan `, mode: "--plan" },
    { prefix: `${publicCommand} --no-plan `, mode: "--no-plan" },
    { prefix: `${publicCommand} --grill `, mode: "--grill" },
    { prefix: `${publicCommand} --hotfix `, mode: "--hotfix" },
    { prefix: "/pipeline diagnostic ", mode: "diagnostic" },
    { prefix: "/pipeline continue", mode: "continue" },
    { prefix: "/pipeline review-only ", mode: "review-only" },
    { prefix: "/pipeline --simples ", mode: "--simples" },
    { prefix: "/pipeline --media ", mode: "--media" },
    { prefix: "/pipeline --complexa ", mode: "--complexa" },
    { prefix: "/pipeline --plan ", mode: "--plan" },
    { prefix: "/pipeline --no-plan ", mode: "--no-plan" },
    { prefix: "/pipeline --grill ", mode: "--grill" },
    { prefix: "/pipeline --hotfix ", mode: "--hotfix" },
  ];

  for (const { prefix, mode } of prefixes) {
    if (trimmedInput === prefix.trimEnd()) {
      return { mode, normalizedRequest: "" };
    }

    if (trimmedInput.startsWith(prefix)) {
      return {
        mode,
        normalizedRequest: trimmedInput.slice(prefix.length).trimStart(),
      };
    }
  }

  if (trimmedInput.startsWith(`${publicCommand} `)) {
    return {
      mode: "full",
      normalizedRequest: trimmedInput.slice(`${publicCommand} `.length).trimStart(),
    };
  }

  if (trimmedInput.startsWith("/pipeline ")) {
    return {
      mode: "full",
      normalizedRequest: trimmedInput.slice("/pipeline ".length).trimStart(),
    };
  }

  return {
    mode: "full",
    normalizedRequest: trimmedInput,
  };
}
