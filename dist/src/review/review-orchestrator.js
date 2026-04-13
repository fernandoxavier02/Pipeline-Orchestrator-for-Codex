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
export function createReviewOrchestrator(dependencies = {}) {
    const runRole = dependencies.runRole ?? dispatchRole;
    return {
        async reviewBatch(input) {
            const files = input.changedFiles?.length ? input.changedFiles : input.batch.files;
            const dispatch = await runRole({
                mode: "multi-agent",
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
                strategy: "fresh-context-multi-agent",
                batch: input.batch.name,
                files,
                changedDomains: input.changedDomains ?? [],
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
