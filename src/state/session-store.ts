import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sessionStateSchema } from "../domain/pipeline-schemas.js";

export function createSessionStore(root: string) {
  const file = join(root, "session.json");

  return {
    async save(session: unknown) {
      const parsed = sessionStateSchema.parse(session);
      await mkdir(root, { recursive: true });
      await writeFile(file, JSON.stringify(parsed), "utf8");
    },
    async load() {
      const raw = await readFile(file, "utf8");
      return sessionStateSchema.parse(JSON.parse(raw));
    },
  };
}
