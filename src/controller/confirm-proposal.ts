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
