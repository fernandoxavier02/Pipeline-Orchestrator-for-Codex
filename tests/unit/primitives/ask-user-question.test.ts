import { describe, it, expect, vi } from "vitest";
import { askUserQuestion } from "../../../src/primitives/ask-user-question.js";

describe("askUserQuestion emulator", () => {
  it("serializes a confirmation question and returns user response when confirmed", async () => {
    const transport = vi.fn(async (_prompt: string) => "yes");
    const result = await askUserQuestion(
      {
        id: "q1",
        type: "confirmation",
        prompt: "Proceed?",
        options: ["yes", "no"],
        gateName: "PROPOSAL_CONFIRM",
      },
      transport,
    );
    expect(result.raw).toBe("yes");
    expect(transport).toHaveBeenCalledOnce();
  });

  it("rejects free-typed response that does not match allowed options for choice type", async () => {
    const transport = vi.fn(async () => "maybe");
    await expect(
      askUserQuestion(
        {
          id: "q2",
          type: "choice",
          prompt: "Pick one",
          options: ["simples", "media", "complexa"],
          gateName: "CLASSIFICATION_OVERRIDE",
        },
        transport,
      ),
    ).rejects.toThrow(/does not match allowed options/);
  });

  it("includes the gate name in the serialized prompt for traceability", async () => {
    const transport = vi.fn(async (prompt: string) => {
      expect(prompt).toContain("[Gate: PROPOSAL_CONFIRM]");
      return "yes";
    });
    await askUserQuestion(
      {
        id: "q3",
        type: "confirmation",
        prompt: "OK?",
        options: ["yes", "no"],
        gateName: "PROPOSAL_CONFIRM",
      },
      transport,
    );
  });
});
