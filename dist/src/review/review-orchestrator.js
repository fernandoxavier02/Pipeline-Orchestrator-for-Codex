import { runRole as dispatchRole } from "../dispatcher/run-role.js";
function parseDispatchedReviews(dispatch) {
    const agents = dispatch.output
        && typeof dispatch.output === "object"
        && "agents" in dispatch.output
        && Array.isArray(dispatch.output.agents)
        ? dispatch.output.agents
        : [];
    return agents
        .filter((agent) => typeof agent.role === "string")
        .map((agent) => {
        const agentOutput = agent.output && typeof agent.output === "object"
            ? agent.output
            : {};
        const findings = Array.isArray(agentOutput.findings)
            ? agentOutput.findings.filter((finding) => !!finding && typeof finding === "object")
            : [];
        return {
            reviewer: agent.role,
            status: typeof agentOutput.status === "string" ? agentOutput.status : "approved",
            findings,
        };
    });
}
// Spec: pipeline-trust-restoration / R3 — Review Orchestrators Inherit Cascade.
// `requireRealAgent` (boolean) is preserved for backward-compat with existing
// fixtures; new callers should pass `requireRealAgentForRequest`, a lazy
// resolver evaluated per dispatch. When both are absent the orchestrator
// defaults to emulation (legacy behavior). When both are present the lazy
// resolver wins (it can observe the actual request, which is the SSOT for
// the cascade — see src/runtime/strict-resolution.ts).
export function createReviewOrchestrator(dependencies = {}) {
    const runRole = dependencies.runRole ?? dispatchRole;
    function resolveRequireRealAgentForReview(request) {
        if (dependencies.requireRealAgentForRequest) {
            return dependencies.requireRealAgentForRequest(request);
        }
        return dependencies.requireRealAgent === true;
    }
    return {
        async reviewBatch(input) {
            const files = input.changedFiles?.length ? input.changedFiles : input.batch.files;
            const reviewLoop = input.reviewLoop ?? {
                iteration: 0,
                maxIterations: 3,
                afterFix: false,
            };
            // R3 — resolve requireRealAgent per dispatch using the lazy resolver
            // (or fall back to the legacy boolean). The resolver observes the
            // request so it can apply the same cascade as runtimeRunRole.
            //
            // Post-review fix (C1): the probe's `requireRealAgent` field MUST be
            // undefined, NOT false. The resolver uses `??` (nullish-coalescing),
            // which only short-circuits on null/undefined. Setting the probe to
            // `false` here would override tier 1 of the cascade and silently
            // collapse strictAgents=true to false at the review surface — recreating
            // the exact Emulation Theatre R3 was supposed to eliminate.
            const requireRealAgentProbe = {
                mode: "parallel-emulation",
                requireRealAgent: undefined,
                role: "review-orchestrator",
                prompt: "review-orchestrator strict-resolution probe",
                input: {
                    batch: { name: input.batch.name, files: [...files] },
                    files: [...files],
                    changedDomains: [...(input.changedDomains ?? [])],
                    mode: input.mode,
                    reviewLoop,
                    reviewOnly: true,
                },
                filesInScope: [...files],
                authorityLevel: "controller",
                freshContext: true,
                reviewOnly: true,
                team: [],
            };
            const requireRealAgent = resolveRequireRealAgentForReview(requireRealAgentProbe);
            const dispatch = await runRole({
                mode: "parallel-emulation",
                requireRealAgent,
                role: "review-orchestrator",
                prompt: "Coordinate an independent batch review team from fresh context.",
                input: {
                    batch: {
                        name: input.batch.name,
                        files: [...files],
                    },
                    files: [...files],
                    changedDomains: [...(input.changedDomains ?? [])],
                    mode: input.mode,
                    reviewLoop,
                    reviewOnly: true,
                },
                filesInScope: [...files],
                authorityLevel: "controller",
                team: [
                    {
                        role: "batch-reviewer",
                        prompt: [
                            "review only the current batch from fresh context.",
                            "Use only the provided file list and batch metadata.",
                            "Do not assume any implementation summary or prior execution context.",
                        ].join(" "),
                        input: {
                            batch: {
                                name: input.batch.name,
                                files: [...files],
                            },
                            files: [...files],
                            changedDomains: [...(input.changedDomains ?? [])],
                            mode: input.mode,
                            reviewLoop,
                            reviewOnly: true,
                        },
                        filesInScope: [...files],
                        authorityLevel: "reviewer",
                        freshContext: true,
                        reviewOnly: true,
                    },
                    {
                        role: "executor-spec-reviewer",
                        prompt: [
                            "review the current batch from fresh context.",
                            "Check requirement compliance directly from the changed files and batch metadata.",
                            "Do not trust implementation summaries or prior execution narrative.",
                        ].join(" "),
                        input: {
                            batch: {
                                name: input.batch.name,
                                files: [...files],
                            },
                            files: [...files],
                            changedDomains: [...(input.changedDomains ?? [])],
                            mode: input.mode,
                            reviewLoop,
                            reviewOnly: true,
                        },
                        filesInScope: [...files],
                        authorityLevel: "reviewer",
                        freshContext: true,
                        reviewOnly: true,
                    },
                    {
                        role: "quality-reviewer",
                        prompt: [
                            "review the current batch from fresh context.",
                            "Focus on verification quality, regression confidence, and evidence gaps only.",
                        ].join(" "),
                        input: {
                            batch: {
                                name: input.batch.name,
                                files: [...files],
                            },
                            files: [...files],
                            changedDomains: [...(input.changedDomains ?? [])],
                            mode: input.mode,
                            reviewLoop,
                            reviewOnly: true,
                        },
                        filesInScope: [...files],
                        authorityLevel: "reviewer",
                        freshContext: true,
                        reviewOnly: true,
                    },
                ],
                freshContext: true,
                reviewOnly: true,
            });
            return {
                strategy: "fresh-context-parallel-emulation",
                batch: input.batch.name,
                files,
                changedDomains: input.changedDomains ?? [],
                reviewLoop,
                status: dispatch.output
                    && typeof dispatch.output === "object"
                    && "status" in dispatch.output
                    && typeof dispatch.output.status === "string"
                    ? dispatch.output.status
                    : "approved",
                findings: dispatch.output
                    && typeof dispatch.output === "object"
                    && "findings" in dispatch.output
                    && Array.isArray(dispatch.output.findings)
                    ? dispatch.output.findings
                    : [],
                reviews: parseDispatchedReviews(dispatch),
                dispatch,
            };
        },
    };
}
