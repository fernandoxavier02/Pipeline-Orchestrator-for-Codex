import { resumePipeline } from "../continue/resume-pipeline.js";
import { buildProposal } from "./build-proposal.js";
import { classifyRequest } from "./classify-request.js";
import { parseMode } from "./parse-mode.js";
import { runInformationGate } from "../gates/information-gate.js";

export function createPipelineController(runtime?: {
  stores?: {
    session: { load: () => Promise<unknown> };
    checkpoints: { list: () => Promise<Array<{ name: string; status: string }>> };
  };
}) {
  return {
    async start(input: string): Promise<any> {
      const { mode, normalizedRequest } = parseMode(input);

      if (mode === "continue") {
        const session = (await runtime?.stores?.session.load?.()) as {
          currentPhase: string;
        };
        const checkpoints = (await runtime?.stores?.checkpoints.list?.()) as Array<{
          name: string;
          status: string;
        }>;

        return resumePipeline({
          session,
          checkpoints,
        });
      }

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
