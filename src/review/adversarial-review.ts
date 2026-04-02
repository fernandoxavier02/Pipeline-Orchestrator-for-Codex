import { detectChangedDomains, requiresMandatoryAdversarialReview, resolveAdversarialChecklists } from "./domain-checklists.js";
import { createReviewOrchestrator } from "./review-orchestrator.js";

export async function runAdversarialReview(input: {
  batch: { name: string; files: string[] };
  findings?: Array<{ severity: string }>;
  changedFiles?: string[];
  changedDomains?: string[];
  mode?: string;
  reviewOrchestrator?: ReturnType<typeof createReviewOrchestrator>;
}) {
  const files = input.changedFiles?.length ? input.changedFiles : input.batch.files;
  const changedDomains = input.changedDomains?.length
    ? input.changedDomains
    : detectChangedDomains(files);
  const checklists = resolveAdversarialChecklists({
    files,
    changedDomains,
    mode: input.mode,
  });
  const required = input.mode === "--hotfix"
    ? checklists.length > 0
    : requiresMandatoryAdversarialReview({
        files,
        changedDomains,
      });
  const reviewOrchestrator = input.reviewOrchestrator ?? createReviewOrchestrator();
  const review =
    input.findings && input.findings.length > 0
      ? {
          findings: input.findings,
          strategy: "provided-findings",
        }
      : await reviewOrchestrator.reviewBatch({
          batch: input.batch,
          changedDomains,
          changedFiles: files,
          mode: input.mode,
        });
  const findings = review.findings ?? [];
  const blocking = findings.some(
    (finding) =>
      finding.severity === "critical" || finding.severity === "important",
  );

  return {
    batch: input.batch.name,
    files,
    changedDomains,
    checklists,
    required,
    gate: required ? "ADVERSARIAL_GATE_MANDATORY" : "ADVERSARIAL_GATE",
    decision: required ? "escalate" : "review",
    status: blocking ? "blocked" : "approved",
    findings,
    strategy: review.strategy,
  };
}
