import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const SPEC_REQUIRED_FILES = ["requirements.md", "design.md", "tasks.md"] as const;

export type SpecLifecycleValidation =
  | {
      status: "passed";
      specPath: string;
      missingArtifacts: [];
    }
  | {
      status: "blocked";
      specPath: string;
      missingArtifacts: string[];
    };

export type SpecTraceabilityValidation =
  | {
      status: "passed";
      acceptanceCriteria: string[];
      missingTraceability: [];
    }
  | {
      status: "blocked";
      acceptanceCriteria: string[];
      missingTraceability: string[];
    };

export type SpecGateValidation =
  | {
      status: "passed";
      detail: string;
      evidence?: string[];
    }
  | {
      status: "blocked";
      detail: string;
      evidence?: string[];
    };

export function isSpecLifecycleVariant(variant: string) {
  return variant.startsWith("spec-");
}

export function deriveSpecIdFromRequest(request: string): string {
  const normalized = request
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^\/pipeline\s+/u, "")
    .replace(/\b(criar|create|fechar|close|implementar|implement|validar|validate|spec|para|for|de|do|da|the|a|an|um|uma)\b/gu, " ")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return normalized || "spec-request";
}

export function validateSpecLifecycleArtifacts(input: {
  workspaceRoot: string;
  variant: string;
  specId: string;
}): SpecLifecycleValidation {
  const specPath = join(input.workspaceRoot, ".kiro", "specs", input.specId);
  const missingArtifacts = SPEC_REQUIRED_FILES
    .filter((file) => !existsSync(join(specPath, file)));

  if (missingArtifacts.length === 0) {
    return {
      status: "passed",
      specPath,
      missingArtifacts: [],
    };
  }

  return {
    status: "blocked",
    specPath,
    missingArtifacts,
  };
}

function extractAcceptanceCriteriaIds(requirements: string): string[] {
  const criteria = requirements
    .split(/\r?\n/u)
    .map((line) => line.match(/^\s*(\d+)\.\s+\S/u)?.[1])
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => `AC${entry}`);

  return [...new Set(criteria)];
}

function readSpecFile(specPath: string, file: string) {
  return readFileSync(join(specPath, file), "utf8");
}

function hasHeading(content: string, heading: string) {
  return new RegExp(`^\\s*#\\s+${heading}\\b`, "imu").test(content);
}

function findReviewStatus(specPath: string, files: string[]) {
  for (const file of files) {
    const reviewPath = join(specPath, file);

    if (!existsSync(reviewPath)) {
      continue;
    }

    const content = readFileSync(reviewPath, "utf8");
    const parsedJson = parseJsonReview(content);
    const status = parsedJson?.status ?? content.match(/^\s*(?:[-*]\s*)?STATUS\s*[:=-]\s*([A-Z_-]+)/imu)?.[1];
    const evidence = parsedJson?.evidence ?? extractEvidenceLines(content);

    if (!status) {
      continue;
    }

    const normalized = status.toUpperCase().replace(/_/gu, "-");

    if (["NO-GO", "NOGO", "BLOCKED", "FAIL", "FAILED"].includes(normalized)) {
      return {
        status: "blocked" as const,
        detail: `${file} reported STATUS=${status}`,
        evidence,
      };
    }

    if (["PASS", "PASSED", "GO", "APPROVED"].includes(normalized)) {
      return {
        status: "passed" as const,
        detail: `${file} reported STATUS=${status}`,
        evidence,
      };
    }
  }

  return undefined;
}

function parseJsonReview(content: string) {
  try {
    const parsed = JSON.parse(content) as { STATUS?: unknown; status?: unknown; EVIDENCE?: unknown; evidence?: unknown };
    const status = parsed.STATUS ?? parsed.status;
    const evidenceValue = parsed.EVIDENCE ?? parsed.evidence;
    const evidence = Array.isArray(evidenceValue)
      ? evidenceValue.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [];
    return typeof status === "string" ? { status, evidence } : undefined;
  } catch {
    return undefined;
  }
}

function extractEvidenceLines(content: string) {
  return content
    .split(/\r?\n/u)
    .filter((line) => /^\s*(?:[-*]\s*)?EVIDENCE\s*[:=-]\s*\S/imu.test(line));
}

export function validateSpecFormatGate(input: {
  specPath: string;
}): SpecGateValidation {
  const reviewFailure = findReviewStatus(input.specPath, [
    "reviews/spec-format-gate.json",
    "reviews/spec-format-gate.md",
  ]);

  if (reviewFailure) {
    return reviewFailure;
  }

  const requiredHeadings = [
    ["requirements.md", "Requirements"],
    ["design.md", "Design"],
    ["tasks.md", "Tasks"],
  ] as const;
  const failures = requiredHeadings
    .filter(([file, heading]) => !hasHeading(readSpecFile(input.specPath, file), heading))
    .map(([file, heading]) => `${file} missing # ${heading}`);

  if (failures.length > 0) {
    return {
      status: "blocked",
      detail: failures.join("; "),
    };
  }

  return {
    status: "passed",
    detail: "Spec format gate passed.",
  };
}

export function validateSpecContentReviewGate(input: {
  specPath: string;
}): SpecGateValidation {
  const reviewStatus = findReviewStatus(input.specPath, [
    "reviews/spec-content-reviewer.json",
    "reviews/spec-content-reviewer.md",
  ]);

  if (!reviewStatus) {
    return {
      status: "blocked",
      detail: "Missing explicit spec-content-reviewer PASS/GO evidence.",
    };
  }

  if (reviewStatus.status === "blocked") {
    return reviewStatus;
  }

  if (!reviewStatus.evidence || reviewStatus.evidence.length === 0) {
    return {
      status: "blocked",
      detail: "spec-content-reviewer PASS/GO is missing evidence.",
    };
  }

  const artifacts = SPEC_REQUIRED_FILES.map((file) => [file, readSpecFile(input.specPath, file)] as const);
  const placeholders = artifacts
    .filter(([, content]) => /\b(TODO|TBD|PLACEHOLDER)\b/iu.test(content))
    .map(([file]) => `${file} contains unresolved placeholder text`);

  if (placeholders.length > 0) {
    return {
      status: "blocked",
      detail: placeholders.join("; "),
    };
  }

  return {
    status: "passed",
    detail: reviewStatus.detail,
    evidence: reviewStatus.evidence,
  };
}

export function validateSpecPostImplementationGate(input: {
  specPath: string;
}): SpecGateValidation {
  const reviewStatus = findReviewStatus(input.specPath, [
    "reviews/spec-post-impl-validator.json",
    "reviews/spec-post-impl-validator.md",
  ]);

  if (!reviewStatus) {
    return {
      status: "blocked",
      detail: "Missing explicit spec-post-impl-validator PASS/GO evidence.",
    };
  }

  if (reviewStatus.status === "blocked") {
    return reviewStatus;
  }

  if (!reviewStatus.evidence || reviewStatus.evidence.length === 0) {
    return {
      status: "blocked",
      detail: "spec-post-impl-validator PASS/GO is missing evidence.",
    };
  }

  return {
    status: "passed",
    detail: reviewStatus.detail,
    evidence: reviewStatus.evidence,
  };
}

export function validateSpecAcceptanceTraceability(input: {
  specPath: string;
}): SpecTraceabilityValidation {
  const requirementsPath = join(input.specPath, "requirements.md");
  const tasksPath = join(input.specPath, "tasks.md");

  if (!existsSync(requirementsPath) || !existsSync(tasksPath)) {
    return {
      status: "blocked",
      acceptanceCriteria: [],
      missingTraceability: ["requirements.md", "tasks.md"],
    };
  }

  const requirements = readFileSync(requirementsPath, "utf8");
  const tasks = readFileSync(tasksPath, "utf8");
  const acceptanceCriteria = extractAcceptanceCriteriaIds(requirements);
  const missingTraceability = acceptanceCriteria.filter((criterion) => !tasks.includes(criterion));

  if (missingTraceability.length === 0) {
    return {
      status: "passed",
      acceptanceCriteria,
      missingTraceability: [],
    };
  }

  return {
    status: "blocked",
    acceptanceCriteria,
    missingTraceability,
  };
}
