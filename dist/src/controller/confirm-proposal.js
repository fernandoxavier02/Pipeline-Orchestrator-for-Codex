const RESPONSE_TO_STATUS = {
    yes: "APPROVED",
    no: "REJECTED",
    adjust: "ADJUSTED",
};
export function confirmProposal(response) {
    const normalized = response.trim().toLowerCase();
    if (normalized !== "yes" && normalized !== "no" && normalized !== "adjust") {
        throw new Error(`Unsupported proposal response: ${response}`);
    }
    return {
        kind: "PROPOSAL_CONFIRMATION",
        status: RESPONSE_TO_STATUS[normalized],
        response: normalized,
    };
}
