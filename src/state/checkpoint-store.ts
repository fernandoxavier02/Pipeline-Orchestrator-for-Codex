import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { checkpointListSchema, checkpointSchema } from "../domain/pipeline-schemas.js";
import { resolveValidatedRoot } from "./path-validation.js";

const PHASE_ORDER: Record<string, number> = {
  "phase-0": 0,
  "phase-1": 1,
  "phase-1.5": 2,
  "phase-2": 3,
  "phase-3": 4,
};

function compareCheckpoints(left: {
  phase?: string;
  batchIndex?: number;
  timestamp?: string;
  name: string;
}, right: {
  phase?: string;
  batchIndex?: number;
  timestamp?: string;
  name: string;
}) {
  const phaseDiff = (PHASE_ORDER[left.phase ?? "phase-0"] ?? 0) - (PHASE_ORDER[right.phase ?? "phase-0"] ?? 0);
  if (phaseDiff !== 0) {
    return phaseDiff;
  }

  const batchDiff = (left.batchIndex ?? 0) - (right.batchIndex ?? 0);
  if (batchDiff !== 0) {
    return batchDiff;
  }

  const leftTime = left.timestamp ? Date.parse(left.timestamp) : Number.NaN;
  const rightTime = right.timestamp ? Date.parse(right.timestamp) : Number.NaN;
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  return left.name.localeCompare(right.name);
}

function inferLegacyCheckpoint(name: string, fallbackTimestamp: string) {
  const match = name.match(/^(.*)-batch-(\d+)$/);
  return {
    phase: match?.[1] ?? "phase-0",
    batchIndex: match ? Number.parseInt(match[2], 10) : 0,
    timestamp: fallbackTimestamp,
  };
}

function normalizeCheckpointRow(input: Record<string, unknown>, fallbackTimestamp: string) {
  const name = typeof input.name === "string" ? input.name : "checkpoint";
  const inferred = inferLegacyCheckpoint(name, fallbackTimestamp);
  const status =
    input.status === "pending" || input.status === "completed" || input.status === "failed"
      ? input.status
      : "pending";

  return checkpointSchema.parse({
    name,
    phase: typeof input.phase === "string" ? input.phase : inferred.phase,
    batchIndex: typeof input.batchIndex === "number" ? input.batchIndex : inferred.batchIndex,
    status,
    timestamp: typeof input.timestamp === "string" ? input.timestamp : inferred.timestamp,
    detail: typeof input.detail === "string" ? input.detail : undefined,
  });
}

export function createCheckpointStore(root: string) {
  const validatedRoot = resolveValidatedRoot(root);
  const dir = join(validatedRoot, "checkpoints");
  const legacyFile = join(validatedRoot, "checkpoints.json");

  return {
    root: validatedRoot,
    async save(checkpoint: unknown) {
      const parsed = checkpointSchema.parse(checkpoint);

      await mkdir(dir, { recursive: true });
      const filename = `${parsed.phase}-${parsed.batchIndex}-${Date.now()}-${randomUUID()}.json`;
      await writeFile(join(dir, filename), JSON.stringify(parsed), "utf8");
    },
    async list() {
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        const checkpoints = await Promise.all(
          entries
            .sort((left, right) => left.name.localeCompare(right.name))
            .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
            .map(async (entry) => {
              const filePath = join(dir, entry.name);
              return checkpointSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
            }),
        ).then((items) => items.sort(compareCheckpoints));

        return checkpointListSchema.parse(checkpoints);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      try {
            const raw = await readFile(legacyFile, "utf8");
            const fallbackTimestamp = (await stat(legacyFile)).mtime.toISOString();
            const legacyRows = JSON.parse(raw) as Array<Record<string, unknown>>;
            const legacyCheckpoints = checkpointListSchema.parse(
              legacyRows.map((row) => {
                const strict = checkpointSchema.safeParse(row);
                if (strict.success) {
                  return strict.data;
                }

                return normalizeCheckpointRow(row, fallbackTimestamp);
              }),
            );
            return legacyCheckpoints;
          } catch (legacyError) {
            if (legacyError instanceof Error && "code" in legacyError && legacyError.code === "ENOENT") {
              return [];
            }

            throw legacyError;
          }
        }

        throw error;
      }
    },
  };
}
