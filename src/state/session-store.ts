import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sessionStateSchema } from "../domain/pipeline-schemas.js";
import { createExecutionIdentity } from "../observability/execution-identity.js";
import { writeFileAtomic } from "./atomic-write.js";
import { resolveValidatedRoot } from "./path-validation.js";

export function createSessionStore(root: string) {
  const validatedRoot = resolveValidatedRoot(root);
  const file = join(validatedRoot, "session.json");

  return {
    root: validatedRoot,
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
