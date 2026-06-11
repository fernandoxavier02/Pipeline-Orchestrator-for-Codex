import { cp } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPipelineRuntime } from "../../../src/index.js";
import { createSessionStore } from "../../../src/state/session-store.js";
describe("diagnostic mode", () => {
    it("stops after proposal and marks the run as non-executing", { timeout: 10000 }, async () => {
        const runtime = createPipelineRuntime({
            cwd: process.cwd(),
            codexHome: "/codex-home",
        });
        const result = await runtime.controller.start("/pipeline diagnostic audit auth flow");
        expect(result.mode).toBe("diagnostic");
        expect(result.stoppedAfterProposal).toBe(true);
    });
    it("does not leave a resumable approval session behind", { timeout: 30000 }, async () => {
        const root = mkdtempSync(join(tmpdir(), "pipeline-diagnostic-"));
        await cp(join(process.cwd(), "references"), join(root, "references"), { recursive: true });
        const runtime = createPipelineRuntime({
            cwd: root,
            codexHome: "/codex-home",
        });
        await runtime.controller.start("/pipeline diagnostic audit auth flow");
        await expect(createSessionStore(runtime.stateDir).load()).rejects.toThrow();
    });
});
