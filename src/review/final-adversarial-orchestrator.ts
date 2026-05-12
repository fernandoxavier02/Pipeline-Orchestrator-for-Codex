import { detectChangedDomains } from "./domain-checklists.js";
import { runRole as dispatchRole } from "../dispatcher/run-role.js";
import type { DispatchRequest, DispatchResult } from "../dispatcher/dispatcher-types.js";

type FinalAdversarialFinding = {
  id: string;
  severity: string;
  summary: string;
  file: string;
  reviewer?: string;
};

type FinalReview = {
  reviewer: string;
  status: string;
  findings: FinalAdversarialFinding[];
  notes?: string[];
};

type FinalReviewScope = {
  files: string[];
};

type FinalReviewDispatcher = (request: DispatchRequest) => Promise<DispatchResult>;

function severityRank(severity: string) {
  switch (severity) {
    case "critical":
      return 0;
    case "important":
      return 1;
    case "minor":
      return 2;
    default:
      return 3;
  }
}

function aggregateFinalReviews(input: {
  scope: FinalReviewScope;
  reviews: FinalReview[];
}) {
  const findings = input.reviews
    .flatMap((review) => review.findings.map((finding) => ({
      ...finding,
      reviewer: review.reviewer,
    })))
    .sort((left, right) => severityRank(left.severity) - severityRank(right.severity));
  const blockedReviews = input.reviews.filter((review) => review.status !== "approved");
  const approvedReviews = input.reviews.filter((review) => review.status === "approved");
  const contradictions =
    blockedReviews.length > 0 && approvedReviews.length > 0
      ? [
          {
            kind: "status-conflict",
            reviewers: [
              ...new Set([
                ...approvedReviews.map((review) => review.reviewer),
                ...blockedReviews.map((review) => review.reviewer),
              ]),
            ],
            summary: "Independent final reviewers disagreed on whether the batch is safe to ship.",
          },
        ]
      : [];
  const finalDecision =
    blockedReviews.length > 0 || findings.some((finding) => severityRank(finding.severity) <= 1)
      ? "blocked"
      : "approved";

  return {
    status: finalDecision === "blocked" ? "rework" : "approved",
    finalDecision,
    findings,
    contradictions,
    reviews: input.reviews,
    reviewers: input.reviews.map((review) => review.reviewer),
    scope: input.scope,
  };
}

function normalizeReviewerResult(input: {
  reviewer: "security" | "architecture" | "quality";
  dispatch: DispatchResult;
}) {
  const output = input.dispatch.output;
  const findings =
    output
    && typeof output === "object"
    && "findings" in output
    && Array.isArray(output.findings)
      ? output.findings as FinalAdversarialFinding[]
      : [];
  const status =
    output
    && typeof output === "object"
    && "status" in output
    && typeof output.status === "string"
      ? output.status
      : findings.some((finding) => severityRank(finding.severity) <= 1)
        ? "blocked"
        : "approved";

  return {
    reviewer: input.reviewer,
    status,
    findings,
  } satisfies FinalReview;
}

export function createFinalAdversarialOrchestrator(dependencies: {
  runRole?: FinalReviewDispatcher;
} = {}) {
  const runRole = dependencies.runRole ?? dispatchRole;

  return {
    async reviewFinal(input: {
      scope: FinalReviewScope;
      changedDomains?: string[];
      reviews?: FinalReview[];
    }) {
      const files = input.scope.files;
      const changedDomains = input.changedDomains?.length
        ? input.changedDomains
        : detectChangedDomains(files);
      const reviewerSpecs = [
        {
          reviewer: "security" as const,
          role: "security-reviewer",
          prompt: "Perform a final adversarial security review from fresh context using only the provided scope.",
        },
        {
          reviewer: "architecture" as const,
          role: "architecture-reviewer",
          prompt: "Perform a final adversarial architecture review from fresh context using only the provided scope.",
        },
        {
          reviewer: "quality" as const,
          role: "quality-reviewer",
          prompt: "Perform a final adversarial quality review from fresh context using only the provided scope.",
        },
      ];

      const dispatch = await runRole({
        mode: "parallel-emulation",
        role: "final-adversarial-orchestrator",
        prompt: "Coordinate the independent final adversarial review team.",
        input: {
          scope: {
            files: [...files],
          },
          files: [...files],
          changedDomains: [...changedDomains],
          reviewOnly: true,
        },
        filesInScope: [...files],
        authorityLevel: "controller",
        team: reviewerSpecs.map((spec) => ({
          role: spec.role,
          prompt: spec.prompt,
          input: {
            scope: {
              files: [...files],
            },
            files: [...files],
            changedDomains: [...changedDomains],
            reviewOnly: true,
          },
          filesInScope: [...files],
          authorityLevel: "reviewer" as const,
          freshContext: true,
          reviewOnly: true,
        })),
        freshContext: true,
        reviewOnly: true,
      });
      const agentOutputs =
        dispatch.output
        && typeof dispatch.output === "object"
        && "agents" in dispatch.output
        && Array.isArray(dispatch.output.agents)
          ? dispatch.output.agents as Array<{ role: string; output: Record<string, unknown> }>
          : [];
      const aggregateFindings =
        dispatch.output
        && typeof dispatch.output === "object"
        && "findings" in dispatch.output
        && Array.isArray(dispatch.output.findings)
          ? dispatch.output.findings as FinalAdversarialFinding[]
          : [];
      const dispatchedReviews = reviewerSpecs.map((spec) => {
        const agentDispatch = agentOutputs.find((agent) => agent.role === spec.role);
        const fallbackFindings = aggregateFindings.filter((finding) =>
          finding.reviewer === spec.role || finding.reviewer === spec.reviewer,
        );
        const agentOutput = agentDispatch?.output ?? {};
        const agentFindings =
          "findings" in agentOutput && Array.isArray(agentOutput.findings)
            ? agentOutput.findings as FinalAdversarialFinding[]
            : [];
        const mergedFindings = [...agentFindings, ...fallbackFindings];
        const fallbackStatus = mergedFindings.some((finding) => severityRank(finding.severity) <= 1)
          ? "blocked"
          : "approved";

        return normalizeReviewerResult({
          reviewer: spec.reviewer,
          dispatch: {
            mode: "single-agent",
            role: spec.role,
            output: {
              ...agentOutput,
              findings: mergedFindings,
              status:
                typeof agentOutput.status === "string"
                  ? agentOutput.status
                  : fallbackStatus,
            },
          },
        });
      });

      return aggregateFinalReviews({
        scope: input.scope,
        reviews: dispatchedReviews,
      });
    },
  };
}

export async function runFinalAdversarialOrchestrator(input: {
  scope: FinalReviewScope;
  reviews: FinalReview[];
}) {
  return aggregateFinalReviews(input);
}
