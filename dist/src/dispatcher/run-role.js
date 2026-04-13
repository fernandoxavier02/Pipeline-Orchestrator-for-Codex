import { runMultiAgentRole } from "./multi-agent-runner.js";
import { runSingleAgentRole } from "./single-agent-runner.js";
export async function runRole(request) {
    const normalizedRequest = {
        ...request,
        freshContext: request.freshContext ?? request.role.includes("review"),
        reviewOnly: request.reviewOnly ?? false,
    };
    if (request.mode === "multi-agent") {
        return runMultiAgentRole(normalizedRequest);
    }
    return runSingleAgentRole(normalizedRequest);
}
