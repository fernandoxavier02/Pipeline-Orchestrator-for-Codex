import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sentinelStateSchema } from "../domain/pipeline-schemas.js";

export type SentinelState = ReturnType<typeof sentinelStateSchema.parse>;

export function createSentinelStateStore(root: string) {
  const file = join(root, "sentinel-state.json");

  return {
    root,
    async save(state: unknown) {
      const parsed = sentinelStateSchema.parse(state);
      await mkdir(root, { recursive: true });
      await writeFile(file, JSON.stringify(parsed), "utf8");
    },
    async load() {
      const raw = await readFile(file, "utf8");
      return sentinelStateSchema.parse(JSON.parse(raw));
    },
  };
}
