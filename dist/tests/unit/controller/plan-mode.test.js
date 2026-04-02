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
        });
        expect(plan.kind).toBe("IMPLEMENTATION_PLAN");
        expect(plan.status).toBe("APPROVED");
        expect(plan.summary).toBe("harden audit trail");
        expect(plan.affectedFiles).toEqual(["src/controller/pipeline-controller.ts"]);
    });
});
