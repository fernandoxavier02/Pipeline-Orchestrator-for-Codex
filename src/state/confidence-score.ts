import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { confidenceScoreSchema } from "../domain/pipeline-schemas.js";

export function createConfidenceScoreStore(root: string) {
  const file = join(root, "confidence-score.json");

  return {
    async save(score: number) {
      const parsed = confidenceScoreSchema.parse({ score });
      await mkdir(root, { recursive: true });
      await writeFile(file, JSON.stringify(parsed), "utf8");
    },
    async load() {
      const raw = await readFile(file, "utf8");
      return confidenceScoreSchema.parse(JSON.parse(raw));
    },
  };
}
