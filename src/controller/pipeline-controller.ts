import { buildProposal } from "./build-proposal.js";
import { classifyRequest } from "./classify-request.js";
import { parseMode } from "./parse-mode.js";
import { runInformationGate } from "../gates/information-gate.js";

export function createPipelineController() {
  return {
    async start(input: string) {
      const { mode, normalizedRequest } = parseMode(input);
      const classification = classifyRequest(normalizedRequest);
      const infoGate = runInformationGate({
        request: normalizedRequest,
        classification,
        knownFacts: [],
      });
      const proposal = buildProposal(normalizedRequest, classification);

      return {
        mode,
        type: classification.type,
        complexity: classification.complexity,
        variant: classification.variant,
        proposal,
        gates: [infoGate],
      };
    },
  };
}
