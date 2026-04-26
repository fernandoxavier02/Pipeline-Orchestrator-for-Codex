import { askUserQuestion, type UserTransport } from "../primitives/ask-user-question.js";
import type { Question } from "../primitives/primitive-types.js";

export type ProposalConfirmationStatus = "APPROVED" | "ADJUSTED" | "REJECTED";

export interface ProposalConfirmation {
  kind: "PROPOSAL_CONFIRMATION";
  status: ProposalConfirmationStatus;
  response: string;
}

const RESPONSE_TO_STATUS: Record<"yes" | "no" | "adjust", ProposalConfirmationStatus> = {
  yes: "APPROVED",
  no: "REJECTED",
  adjust: "ADJUSTED",
};

export const PROPOSAL_CONFIRMATION_OPTIONS: ReadonlyArray<"yes" | "no" | "adjust"> = [
  "yes",
  "no",
  "adjust",
];

export function confirmProposal(response: string): ProposalConfirmation {
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
export async function confirmProposalViaAsk(input: {
  proposal: { summary: string; variant?: string };
  transport: UserTransport;
  questionId?: string;
  gateName?: string;
}): Promise<ProposalConfirmation> {
  const question: Question = Object.freeze({
    id: input.questionId ?? "PROPOSAL_CONFIRMATION",
    type: "confirmation",
    prompt:
      `Proposal: ${input.proposal.summary}` +
      (input.proposal.variant ? ` (variant: ${input.proposal.variant})` : "") +
      ". Respond yes / adjust / no.",
    options: [...PROPOSAL_CONFIRMATION_OPTIONS],
    gateName: input.gateName ?? "PROPOSAL_CONFIRMATION",
  });
  const response = await askUserQuestion(question, input.transport);
  return confirmProposal(response.raw);
}
