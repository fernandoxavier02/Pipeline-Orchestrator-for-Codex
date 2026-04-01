import { runRole } from "../dispatcher/run-role.js";
import { runAdversarialReview } from "../review/adversarial-review.js";

export async function runBatch(batch: { name: string; files: string[] }) {
  const execution = await runRole({
    mode: "single-agent",
    role: "executor-implementer",
    prompt: "Implement only the current batch.",
    input: { batch },
  });

  const review = await runAdversarialReview({
    batch,
    findings: [],
  });

  return {
    execution,
    review,
  };
}
