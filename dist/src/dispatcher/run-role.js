import { runSingleAgentRole } from "./single-agent-runner.js";
export async function runRole(request) {
    const normalizedRequest = {
        ...request,
        freshContext: request.freshContext ?? request.role.includes("review"),
        reviewOnly: request.reviewOnly ?? false,
    };
    if (request.mode === "multi-agent") {
        throw new Error("Multi-agent mode is not implemented yet");
    }
    return runSingleAgentRole(normalizedRequest);
}
