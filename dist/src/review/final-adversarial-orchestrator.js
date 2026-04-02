import { detectChangedDomains } from "./domain-checklists.js";
import { runRole as dispatchRole } from "../dispatcher/run-role.js";
function severityRank(severity) {
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
function aggregateFinalReviews(input) {
    const findings = input.reviews
        .flatMap((review) => review.findings.map((finding) => ({
        ...finding,
        reviewer: review.reviewer,
    })))
        .sort((left, right) => severityRank(left.severity) - severityRank(right.severity));
    const blockedReviews = input.reviews.filter((review) => review.status !== "approved");
    const approvedReviews = input.reviews.filter((review) => review.status === "approved");
    const contradictions = blockedReviews.length > 0 && approvedReviews.length > 0
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
    const finalDecision = blockedReviews.length > 0 || findings.some((finding) => severityRank(finding.severity) <= 1)
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
function normalizeReviewerResult(input) {
    const output = input.dispatch.output;
    const findings = output
        && typeof output === "object"
        && "findings" in output
        && Array.isArray(output.findings)
        ? output.findings
        : [];
    const status = output
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
    };
}
export function createFinalAdversarialOrchestrator(dependencies = {}) {
    const runRole = dependencies.runRole ?? dispatchRole;
    return {
        async reviewFinal(input) {
            const files = input.scope.files;
            const changedDomains = input.changedDomains?.length
                ? input.changedDomains
                : detectChangedDomains(files);
            const reviewerSpecs = [
                {
                    reviewer: "security",
                    role: "security-reviewer",
                    prompt: "Perform a final adversarial security review from fresh context using only the provided scope.",
                },
                {
                    reviewer: "architecture",
                    role: "architecture-reviewer",
                    prompt: "Perform a final adversarial architecture review from fresh context using only the provided scope.",
                },
                {
                    reviewer: "quality",
                    role: "quality-reviewer",
                    prompt: "Perform a final adversarial quality review from fresh context using only the provided scope.",
                },
            ];
            const dispatchedReviews = await Promise.all(reviewerSpecs.map(async (spec) => normalizeReviewerResult({
                reviewer: spec.reviewer,
                dispatch: await runRole({
                    mode: "single-agent",
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
                    freshContext: true,
                    reviewOnly: true,
                }),
            })));
            return aggregateFinalReviews({
                scope: input.scope,
                reviews: dispatchedReviews,
            });
        },
    };
}
export async function runFinalAdversarialOrchestrator(input) {
    return aggregateFinalReviews(input);
}
