import { runRole as dispatchRole } from "../dispatcher/run-role.js";
import type { DispatchRequest, DispatchResult } from "../dispatcher/dispatcher-types.js";

type ReviewBatch = {
  name: string;
  files: string[];
};

export interface ReviewBatchInput {
  batch: ReviewBatch;
  changedDomains?: string[];
  changedFiles?: string[];
  mode?: string;
  implementationSummary?: string;
}

type ReviewDispatcher = (request: DispatchRequest) => Promise<DispatchResult>;

export function createReviewOrchestrator(dependencies: {
  runRole?: ReviewDispatcher;
} = {}) {
  const runRole = dependencies.runRole ?? dispatchRole;

  return {
    async reviewBatch(input: ReviewBatchInput) {
      const files = input.changedFiles?.length ? input.changedFiles : input.batch.files;
      const dispatch = await runRole({
        mode: "single-agent",
        role: "batch-reviewer",
        prompt: [
          "review only the current batch from fresh context.",
          "Use only the provided file list and batch metadata.",
          "Do not assume any implementation summary or prior execution context.",
        ].join(" "),
        input: {
          batch: {
            name: input.batch.name,
            files: [...files],
          },
          files: [...files],
          changedDomains: [...(input.changedDomains ?? [])],
          mode: input.mode,
          reviewOnly: true,
        },
        freshContext: true,
        reviewOnly: true,
      });

      return {
        strategy: "fresh-context-single-agent",
        batch: input.batch.name,
        files,
        changedDomains: input.changedDomains ?? [],
        status:
          dispatch.output
          && typeof dispatch.output === "object"
          && "status" in dispatch.output
          && typeof dispatch.output.status === "string"
            ? dispatch.output.status
            : "approved",
        findings:
          dispatch.output
          && typeof dispatch.output === "object"
          && "findings" in dispatch.output
          && Array.isArray(dispatch.output.findings)
            ? dispatch.output.findings
            : [],
        dispatch,
      };
    },
  };
}
