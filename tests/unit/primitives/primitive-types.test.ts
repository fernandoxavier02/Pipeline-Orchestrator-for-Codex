import { describe, it, expect } from "vitest";
import {
  QuestionSchema,
  ResponseSchema,
  InteractionSchema,
  PlanSessionSchema,
} from "../../../src/primitives/primitive-types.js";

describe("Question value object", () => {
  it("accepts confirmation question with yes/no options", () => {
    const parsed = QuestionSchema.parse({
      id: "q1",
      type: "confirmation",
      prompt: "Proceed with deployment?",
      options: ["yes", "no"],
      gateName: "PROPOSAL_CONFIRM",
    });
    expect(parsed.type).toBe("confirmation");
  });

  it("rejects choice question without options", () => {
    expect(() =>
      QuestionSchema.parse({
        id: "q2",
        type: "choice",
        prompt: "Pick one",
        gateName: "CLASSIFICATION_OVERRIDE",
      }),
    ).toThrow();
  });

  it("rejects freetext with empty prompt", () => {
    expect(() =>
      QuestionSchema.parse({
        id: "q3",
        type: "freetext",
        prompt: "",
        gateName: "INFO_GATE",
      }),
    ).toThrow();
  });

  it("rejects confirmation question without options", () => {
    expect(() =>
      QuestionSchema.parse({
        id: "q-conf",
        type: "confirmation",
        prompt: "Proceed?",
        gateName: "PROPOSAL_CONFIRM",
      }),
    ).toThrow();
  });

  it("rejects choice question with empty options array", () => {
    expect(() =>
      QuestionSchema.parse({
        id: "q-empty",
        type: "choice",
        prompt: "Pick one",
        options: [],
        gateName: "CLASSIFICATION_OVERRIDE",
      }),
    ).toThrow();
  });

  it("rejects Response with empty questionId", () => {
    expect(() =>
      ResponseSchema.parse({
        questionId: "",
        raw: "yes",
        parsed: "yes",
        timestamp: new Date().toISOString(),
      }),
    ).toThrow();
  });
});

describe("PlanSession aggregate", () => {
  it("starts read-only with zero writes attempted", () => {
    const s = PlanSessionSchema.parse({
      id: "plan-1",
      startTime: new Date().toISOString(),
      readOnly: true,
      writesAttempted: 0,
    });
    expect(s.readOnly).toBe(true);
    expect(s.writesAttempted).toBe(0);
  });

  it("rejects negative writesAttempted", () => {
    expect(() =>
      PlanSessionSchema.parse({
        id: "plan-2",
        startTime: new Date().toISOString(),
        readOnly: true,
        writesAttempted: -1,
      }),
    ).toThrow();
  });

  it("rejects PlanSession with invalid ISO datetime in startTime", () => {
    expect(() =>
      PlanSessionSchema.parse({
        id: "plan-x",
        startTime: "not-a-date",
        readOnly: true,
        writesAttempted: 0,
      }),
    ).toThrow();
  });
});
