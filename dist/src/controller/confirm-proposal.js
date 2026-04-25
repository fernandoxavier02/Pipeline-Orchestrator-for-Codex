import { askUserQuestion } from "../primitives/ask-user-question.js";
const RESPONSE_TO_STATUS = {
    yes: "APPROVED",
    no: "REJECTED",
    adjust: "ADJUSTED",
};
export const PROPOSAL_CONFIRMATION_OPTIONS = [
    "yes",
    "no",
    "adjust",
];
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
/**
 * B6: Wires askUserQuestion into proposal confirmation. Builds a
 * `confirmation`-typed Question keyed to the proposal summary, sends it
 * through the supplied UserTransport, and reduces the validated response
 * into a ProposalConfirmation.
 *
 * The transport is the single seam tests / runtimes can override.
 */
export async function confirmProposalViaAsk(input) {
    const question = Object.freeze({
        id: input.questionId ?? "PROPOSAL_CONFIRMATION",
        type: "confirmation",
        prompt: `Proposal: ${input.proposal.summary}` +
            (input.proposal.variant ? ` (variant: ${input.proposal.variant})` : "") +
            ". Respond yes / adjust / no.",
        options: [...PROPOSAL_CONFIRMATION_OPTIONS],
        gateName: input.gateName ?? "PROPOSAL_CONFIRMATION",
    });
    const response = await askUserQuestion(question, input.transport);
    return confirmProposal(response.raw);
}
