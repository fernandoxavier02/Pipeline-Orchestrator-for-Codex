import { buildProposal } from "./build-proposal.js";
import { classifyRequest } from "./classify-request.js";
import { parseMode } from "./parse-mode.js";

export function createPipelineController() {
  return {
    async start(input: string) {
      const { mode, normalizedRequest } = parseMode(input);
      const classification = classifyRequest(normalizedRequest);
      const proposal = buildProposal(normalizedRequest, classification);

      return {
        mode,
        type: classification.type,
        complexity: classification.complexity,
        variant: classification.variant,
        proposal,
      };
    },
  };
}
