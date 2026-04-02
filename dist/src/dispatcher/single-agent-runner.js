import { detectChangedDomains, isMandatoryReviewDomain } from "../review/domain-checklists.js";
function getRequestFiles(request) {
    const inputFiles = Array.isArray(request.input.files)
        ? request.input.files
        : request.input.batch
            && typeof request.input.batch === "object"
            && "files" in request.input.batch
            && Array.isArray(request.input.batch.files)
            ? request.input.batch.files
            : request.input.scope
                && typeof request.input.scope === "object"
                && "files" in request.input.scope
                && Array.isArray(request.input.scope.files)
                ? request.input.scope.files
                : [];
    return inputFiles.filter((file) => typeof file === "string");
}
function getChangedDomains(request, files) {
    if (Array.isArray(request.input.changedDomains)) {
        return request.input.changedDomains.filter((domain) => typeof domain === "string");
    }
    return detectChangedDomains(files);
}
function createDefaultReviewFindings(request) {
    if (!request.role.includes("review")) {
        return [];
    }
    const files = getRequestFiles(request);
    const changedDomains = getChangedDomains(request, files);
    const requestMode = typeof request.input.mode === "string" ? request.input.mode : undefined;
    const firstFile = files[0] ?? "unknown-file";
    const mandatoryDomains = changedDomains.filter(isMandatoryReviewDomain);
    const hotfixInjectionDomains = requestMode === "--hotfix"
        ? changedDomains.filter((domain) => domain === "injection")
        : [];
    if (request.role === "batch-reviewer" && (mandatoryDomains.length > 0 || hotfixInjectionDomains.length > 0)) {
        const blockedDomains = mandatoryDomains.length > 0 ? mandatoryDomains : hotfixInjectionDomains;
        return [
            {
                id: `default-review-${blockedDomains[0]}`,
                severity: "important",
                summary: `Independent review evidence is required for ${blockedDomains.join(", ")} changes in the default runtime.`,
                file: firstFile,
            },
        ];
    }
    if (request.role === "security-reviewer") {
        const sensitiveDomains = changedDomains.filter((domain) => ["auth", "crypto", "payment", "injection"].includes(domain));
        if (sensitiveDomains.length > 0) {
            return [
                {
                    id: `security-${sensitiveDomains[0]}`,
                    severity: "important",
                    summary: `Security review cannot auto-approve ${sensitiveDomains.join(", ")} changes without independent evidence.`,
                    file: firstFile,
                },
            ];
        }
    }
    if (request.role === "architecture-reviewer") {
        const structuralDomains = changedDomains.filter((domain) => ["data-model", "payment"].includes(domain));
        if (structuralDomains.length > 0) {
            return [
                {
                    id: `architecture-${structuralDomains[0]}`,
                    severity: "important",
                    summary: `Architecture review needs an independent challenge pass for ${structuralDomains.join(", ")} changes.`,
                    file: firstFile,
                },
            ];
        }
    }
    if (request.role === "quality-reviewer" && files.length > 0) {
        return [
            {
                id: "quality-missing-proof",
                severity: "minor",
                summary: "Quality review could not verify dedicated independent regression evidence in the default runtime.",
                file: firstFile,
            },
        ];
    }
    return [];
}
export async function runSingleAgentRole(request) {
    const freshContextRequired = request.freshContext ?? request.role.includes("review");
    const findings = createDefaultReviewFindings(request);
    const status = findings.some((finding) => finding.severity === "critical" || finding.severity === "important")
        ? "blocked"
        : "approved";
    return {
        mode: "single-agent",
        role: request.role,
        output: {
            prompt: request.prompt,
            input: request.input,
            freshContextRequired,
            freshContextEmulated: freshContextRequired,
            contextWindow: freshContextRequired ? "fresh" : "inherited",
            reviewOnly: request.reviewOnly ?? false,
            findings,
            status,
        },
    };
}
