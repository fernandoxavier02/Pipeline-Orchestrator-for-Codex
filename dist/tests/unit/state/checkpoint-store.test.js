import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resumePipeline } from "../../../src/continue/resume-pipeline.js";
import { createCheckpointStore } from "../../../src/state/checkpoint-store.js";
describe("checkpoint store", () => {
    it("orders multi-digit batches numerically before resume uses the list", async () => {
        const root = mkdtempSync(join(tmpdir(), "pipeline-checkpoint-order-"));
        const store = createCheckpointStore(root);
        const dir = join(root, "checkpoints");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "phase-2-batch-2.json"), JSON.stringify({
            name: "phase-2-batch-2",
            phase: "phase-2",
            batchIndex: 2,
            status: "completed",
            timestamp: "2026-04-01T12:00:00.000Z",
        }), "utf8");
        writeFileSync(join(dir, "phase-2-batch-10.json"), JSON.stringify({
            name: "phase-2-batch-10",
            phase: "phase-2",
            batchIndex: 10,
            status: "completed",
            timestamp: "2026-04-01T12:10:00.000Z",
        }), "utf8");
        writeFileSync(join(dir, "phase-2-batch-3.json"), JSON.stringify({
            name: "phase-2-batch-3",
            phase: "phase-2",
            batchIndex: 3,
            status: "completed",
            timestamp: "2026-04-01T12:05:00.000Z",
        }), "utf8");
        const checkpoints = await store.list();
        expect(checkpoints.map((entry) => entry.name)).toEqual([
            "phase-2-batch-2",
            "phase-2-batch-3",
            "phase-2-batch-10",
        ]);
        const result = await resumePipeline({
            session: {
                currentPhase: "phase-2",
            },
            checkpoints,
        });
        expect(result.resumeFrom).toBe("phase-2-batch-10");
    });
    it("rejects malformed current checkpoint artifacts", async () => {
        const root = mkdtempSync(join(tmpdir(), "pipeline-checkpoint-current-"));
        const store = createCheckpointStore(root);
        const dir = join(root, "checkpoints");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "phase-2-batch-2.json"), JSON.stringify({
            name: "phase-2-batch-2",
            status: "completed",
        }), "utf8");
        await expect(store.list()).rejects.toThrow();
    });
    it("replays legacy checkpoints.json rows with compatibility defaults", async () => {
        const root = mkdtempSync(join(tmpdir(), "pipeline-checkpoint-legacy-"));
        const store = createCheckpointStore(root);
        writeFileSync(join(root, "checkpoints.json"), JSON.stringify([
            { name: "phase-2-batch-2", status: "completed" },
            { name: "phase-2-batch-10", status: "completed" },
        ]), "utf8");
        const checkpoints = await store.list();
        expect(checkpoints).toHaveLength(2);
        expect(checkpoints[0]).toMatchObject({
            name: "phase-2-batch-2",
            phase: "phase-2",
            batchIndex: 2,
            status: "completed",
            timestamp: expect.any(String),
        });
        expect(checkpoints[1]).toMatchObject({
            name: "phase-2-batch-10",
            phase: "phase-2",
            batchIndex: 10,
            status: "completed",
            timestamp: expect.any(String),
        });
        const result = await resumePipeline({
            session: { currentPhase: "phase-2" },
            checkpoints,
        });
        expect(result.resumeFrom).toBe("phase-2-batch-10");
        expect(readFileSync(join(root, "checkpoints.json"), "utf8")).toContain("phase-2-batch-10");
    });
    it("preserves append order for legacy checkpoint names that are not phase/batch sortable", async () => {
        const root = mkdtempSync(join(tmpdir(), "pipeline-checkpoint-legacy-order-"));
        const store = createCheckpointStore(root);
        writeFileSync(join(root, "checkpoints.json"), JSON.stringify([
            { name: "review", status: "completed" },
            { name: "plan", status: "completed" },
        ]), "utf8");
        const checkpoints = await store.list();
        expect(checkpoints.map((entry) => entry.name)).toEqual(["review", "plan"]);
        const result = await resumePipeline({
            session: { currentPhase: "phase-2" },
            checkpoints,
        });
        expect(result.resumeFrom).toBe("plan");
    });
});
