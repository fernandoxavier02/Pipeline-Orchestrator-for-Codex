import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { checkpointListSchema, checkpointSchema } from "../domain/pipeline-schemas.js";

export function createCheckpointStore(root: string) {
  const file = join(root, "checkpoints.json");

  return {
    async save(checkpoint: unknown) {
      const parsed = checkpointSchema.parse(checkpoint);
      const checkpoints = await this.list();
      checkpoints.push(parsed);
      await mkdir(root, { recursive: true });
      await writeFile(file, JSON.stringify(checkpoints), "utf8");
    },
    async list() {
      try {
        const raw = await readFile(file, "utf8");
        return checkpointListSchema.parse(JSON.parse(raw));
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          return [];
        }

        throw error;
      }
    },
  };
}
