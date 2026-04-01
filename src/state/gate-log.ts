import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { gateDecisionSchema } from "../domain/pipeline-schemas.js";

export function createGateLog(root: string) {
  const file = join(root, "gate-decisions.jsonl");

  return {
    root,
    async append(decision: unknown) {
      const parsed = gateDecisionSchema.parse(decision);

      await mkdir(root, { recursive: true });
      await appendFile(file, `${JSON.stringify(parsed)}\n`, "utf8");
    },
    async list() {
      try {
        const raw = await readFile(file, "utf8");
        return raw
          .split("\n")
          .filter((line) => line.length > 0)
          .map((line) => gateDecisionSchema.parse(JSON.parse(line)));
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          return [];
        }

        throw error;
      }
    },
  };
}
