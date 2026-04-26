import { describe, expect, it } from "vitest";
import {
  PROPOSAL_CONFIRMATION_OPTIONS,
  confirmProposalViaAsk,
} from "../../../src/controller/confirm-proposal.js";
import type { UserTransport } from "../../../src/primitives/ask-user-question.js";

function transportReturning(value: string): UserTransport {
  return async () => value;
}

describe("confirmProposalViaAsk (B6 wiring)", () => {
  it("APPROVES when the transport returns 'yes'", async () => {
    const result = await confirmProposalViaAsk({
      proposal: { summary: "ship checkout v2", variant: "feature-heavy" },
      transport: transportReturning("yes"),
    });
    expect(result.status).toBe("APPROVED");
    expect(result.response).toBe("yes");
  });

  it("ADJUSTS when the transport returns 'adjust'", async () => {
    const result = await confirmProposalViaAsk({
      proposal: { summary: "ship checkout v2" },
      transport: transportReturning("adjust"),
    });
    expect(result.status).toBe("ADJUSTED");
  });

  it("REJECTS when the transport returns 'no'", async () => {
    const result = await confirmProposalViaAsk({
      proposal: { summary: "ship checkout v2" },
      transport: transportReturning("no"),
    });
    expect(result.status).toBe("REJECTED");
  });

  it("rejects responses outside the allowed option set", async () => {
    await expect(
      confirmProposalViaAsk({
        proposal: { summary: "ship checkout v2" },
        transport: transportReturning("maybe"),
      }),
    ).rejects.toThrow(/does not match allowed options/);
  });

  it("forwards the proposal summary into the prompt presented to the transport", async () => {
    let captured = "";
    await confirmProposalViaAsk({
      proposal: { summary: "ship checkout v2", variant: "feature-heavy" },
      transport: async (prompt) => {
        captured = prompt;
        return "yes";
      },
    });
    expect(captured).toContain("ship checkout v2");
    expect(captured).toContain("feature-heavy");
    for (const option of PROPOSAL_CONFIRMATION_OPTIONS) {
      expect(captured).toContain(option);
    }
  });
});
