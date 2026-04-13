import { describe, expect, it } from "vitest";
import { createImplementationPlan, getPlanModeStatus } from "../../../src/controller/plan-mode.js";
describe("plan mode", () => {
    it("derives a required plan gate for explicit plan requests", () => {
        expect(getPlanModeStatus("--plan", "MEDIA")).toBe("required");
    });
    it("formats an implementation plan from controller-decided approval status", () => {
        const plan = createImplementationPlan({
            status: "APPROVED",
            summary: "harden audit trail",
            affectedFiles: ["src/controller/pipeline-controller.ts"],
            variant: "audit-heavy",
            validationIntent: "standard",
        });
        expect(plan.kind).toBe("IMPLEMENTATION_PLAN");
        expect(plan.status).toBe("APPROVED");
        expect(plan.summary).toBe("harden audit trail");
        expect(plan.affectedFiles).toEqual(["src/controller/pipeline-controller.ts"]);
        expect(plan.tasks).toEqual(expect.arrayContaining([
            "Confirm the failing or review-driving scenarios before implementation.",
            "Implement the scoped change in the affected files.",
            "Run verification and capture approval evidence for the batch.",
        ]));
        expect(plan.risks).toEqual(expect.arrayContaining([
            "State transitions or persistence can drift from the intended pipeline behavior.",
            "Review evidence can become stale if the touched files expand during execution.",
        ]));
    });
});
