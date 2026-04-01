export function buildProposal(request: string, classification: { variant: string }) {
  return {
    summary: request,
    variant: classification.variant,
    awaitingUserConfirmation: true,
    affectedFiles: [],
  };
}
