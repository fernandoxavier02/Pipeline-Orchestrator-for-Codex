import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { allocatePipelineRun, parseRunManifest } from "../../../src/run/run-directory.js";

const require = createRequire(import.meta.url);
const { RunManifest } = require("../../../lib/run-manifest.cjs") as {
  RunManifest: { fromYaml: (text: string) => { status: string; phase: number; step_completed: number | null } };
};
const { RunDirectory } = require("../../../lib/run-directory.cjs") as {
  RunDirectory: { allocate: (rootDir: string, prompt: string) => { absPath: string; runId: string } };
};

describe("v5.2 pipeline run directory", () => {
  it("allocates an atomic numbered run directory with fixed subfolders and manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-runs-root-"));

    const run = await allocatePipelineRun({
      root,
      title: "Codex v5.2 Parity",
      type: "Feature",
      complexity: "COMPLEXA",
      planFlag: "plan",
    });

    expect(run.runId).toMatch(/^001-codex-v5-2-parity$/);
    expect(run.subdirectories.map((dir) => dir.replace(run.runDir, "").replace(/^[/\\]/, ""))).toEqual([
      "00-brainstorm",
      "01-spec",
      "02-validations",
      "03-execution",
      "attachments",
    ]);

    const manifest = parseRunManifest(await readFile(join(run.runDir, "manifest.yaml"), "utf8"));
    const cjsManifest = RunManifest.fromYaml(await readFile(join(run.runDir, "manifest.yaml"), "utf8"));
    expect(manifest).toMatchObject({
      schema_version: 1,
      run_id: "001-codex-v5-2-parity",
      status: "ready",
      phase: 0,
      step_completed: null,
      type: "Feature",
      complexity: "COMPLEXA",
      plan_flag: "plan",
      brainstorm_completed: false,
      spec_lifecycle_completed: false,
      notes: [],
    });
    expect(cjsManifest.status).toBe("ready");
    expect(cjsManifest.phase).toBe(0);
    expect(cjsManifest.step_completed).toBeNull();
  });

  it("increments the run number when a slug already exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-runs-root-"));

    const first = await allocatePipelineRun({ root, title: "Same Feature" });
    const second = await allocatePipelineRun({ root, title: "Same Feature" });

    expect(first.runId).toBe("001-same-feature");
    expect(second.runId).toBe("002-same-feature");
  });

  it("parses CommonJS-created manifests through the TypeScript schema", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-runs-root-"));
    const run = RunDirectory.allocate(root, "CJS created manifest");

    const manifest = parseRunManifest(await readFile(join(run.absPath, "manifest.yaml"), "utf8"));

    expect(manifest).toMatchObject({
      run_id: run.runId,
      status: "ready",
      phase: 0,
      notes: [],
    });
  });

  it("parses legacy string notes as an empty audit list", async () => {
    const root = await mkdtemp(join(tmpdir(), "pipeline-runs-root-"));
    const runDir = join(root, "001-legacy");
    await mkdir(runDir, { recursive: true });

    const manifest = parseRunManifest([
      "schema_version: 1",
      'run_id: "001-legacy"',
      'created_at: "2026-05-10T00:00:00Z"',
      'updated_at: "2026-05-10T00:00:00Z"',
      'status: "ready"',
      "phase: 0",
      "step_completed: null",
      'type: "Unknown"',
      'complexity: "unknown"',
      "brainstorm_completed: false",
      "spec_lifecycle_completed: false",
      "handoff_decision: null",
      "linked_pipeline_doc_path: null",
      'notes: ""',
      "",
    ].join("\n"));

    expect(manifest.notes).toEqual([]);
  });
});
