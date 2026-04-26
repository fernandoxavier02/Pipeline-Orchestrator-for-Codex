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
        const lines = raw.split("\n").filter((line) => line.length > 0);
        const parsed = [];
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index];
          let json;
          try {
            json = JSON.parse(line);
          } catch (jsonError) {
            // B10: tolerate a syntactically-truncated JSON object only when
            // it's on the last line (jsonl crash recovery). Schema/Zod
            // errors and partial JSON elsewhere are always fatal.
            const isLastLine = index === lines.length - 1;
            if (isLastLine) {
              continue;
            }
            throw jsonError;
          }
          parsed.push(gateDecisionSchema.parse(json));
        }
        return parsed;
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          return [];
        }

        throw error;
      }
    },
  };
}
