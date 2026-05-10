import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { writeFileAtomic } from "../state/atomic-write.js";

const RUN_SUBDIRECTORIES = [
  "00-brainstorm",
  "01-spec",
  "02-validations",
  "03-execution",
  "attachments",
] as const;

export const runManifestSchema = z.object({
  schema_version: z.literal(1),
  run_id: z.string().min(1),
  status: z.enum(["ready", "partial", "cancelled", "executing", "completed"]).default("ready"),
  phase: z.number().int().min(0).max(3),
  step_completed: z.number().int().nullable().default(null),
  type: z.enum(["Feature", "Bug Fix", "Audit", "User Story", "UX Simulation", "Spec", "Unknown"]).default("Unknown"),
  complexity: z.enum(["SIMPLES", "MEDIA", "COMPLEXA", "unknown"]).default("unknown"),
  plan_flag: z.enum(["plan", "no-plan"]).nullable().default(null),
  brainstorm_completed: z.boolean().default(false),
  spec_lifecycle_completed: z.boolean().default(false),
  handoff_decision: z.string().nullable().default(null),
  linked_pipeline_doc_path: z.string().nullable().default(null),
  notes: z.union([z.array(z.unknown()), z.string()]).transform((value) => (
    typeof value === "string"
      ? value.length > 0 ? [value] : []
      : value
  )).default([]),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});

export type RunManifest = z.infer<typeof runManifestSchema>;

export interface AllocatePipelineRunInput {
  root: string;
  title: string;
  type?: string;
  complexity?: string;
  planFlag?: "plan" | "no-plan" | null;
}

function slugify(title: string) {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return slug || "pipeline-run";
}

function formatRunId(index: number, slug: string) {
  return `${String(index).padStart(3, "0")}-${slug}`;
}

export function renderRunManifest(manifest: RunManifest) {
  return YAML.stringify(manifest, {
    lineWidth: 0,
  });
}

export function parseRunManifest(raw: string) {
  return runManifestSchema.parse(YAML.parse(raw));
}

export async function readRunManifest(path: string) {
  return parseRunManifest(await readFile(path, "utf8"));
}

export async function writeRunManifest(path: string, manifest: RunManifest) {
  await writeFileAtomic(path, renderRunManifest(runManifestSchema.parse(manifest)));
}

export async function allocatePipelineRun(input: AllocatePipelineRunInput) {
  const slug = slugify(input.title);
  await mkdir(input.root, { recursive: true });

  for (let index = 1; index < 1000; index += 1) {
    const runId = formatRunId(index, slug);
    const runDir = join(input.root, runId);

    try {
      await mkdir(runDir);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        continue;
      }

      throw error;
    }

    const subdirectories = RUN_SUBDIRECTORIES.map((entry) => join(runDir, entry));
    await Promise.all(subdirectories.map((dir) => mkdir(dir, { recursive: true })));

    const now = new Date().toISOString();
    const manifest = runManifestSchema.parse({
      schema_version: 1,
      run_id: runId,
      status: "ready",
      phase: 0,
      step_completed: null,
      type: input.type ?? "Unknown",
      complexity: input.complexity ?? "unknown",
      plan_flag: input.planFlag ?? null,
      brainstorm_completed: false,
      spec_lifecycle_completed: false,
      handoff_decision: null,
      linked_pipeline_doc_path: null,
      notes: [],
      created_at: now,
      updated_at: now,
    });

    await writeFile(join(runDir, "manifest.yaml"), renderRunManifest(manifest), "utf8");

    return {
      runId,
      runDir,
      manifestPath: join(runDir, "manifest.yaml"),
      subdirectories,
      manifest,
    };
  }

  throw new Error(`Could not allocate a pipeline run under ${input.root}: exhausted 001-999.`);
}
