import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sessionStateSchema } from "../domain/pipeline-schemas.js";
import { createExecutionIdentity } from "../observability/execution-identity.js";
import { writeFileAtomic } from "./atomic-write.js";

export function createSessionStore(root: string) {
  const file = join(root, "session.json");

  return {
    root,
    async save(session: unknown) {
      const parsed = sessionStateSchema.parse(session);
      const enriched = {
        ...parsed,
        execution_identity: parsed.execution_identity ?? createExecutionIdentity({
          surface: "session-store",
          sessionId: parsed.sessionId,
          cwd: process.cwd(),
          stateRoot: root,
          source: "runtime",
        }),
      };
      await writeFileAtomic(file, JSON.stringify(enriched));
    },
    async load() {
      const raw = await readFile(file, "utf8");
      return sessionStateSchema.parse(JSON.parse(raw));
    },
  };
}
