import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sessionStateSchema } from "../domain/pipeline-schemas.js";
import { createExecutionIdentity } from "../observability/execution-identity.js";
import { writeFileAtomic } from "./atomic-write.js";
import { resolveValidatedRoot } from "./path-validation.js";
export function createSessionStore(root, defaults = {}) {
    const validatedRoot = resolveValidatedRoot(root);
    const file = join(validatedRoot, "session.json");
    return {
        root: validatedRoot,
        async save(session) {
            const merged = defaults.strictAgents === undefined
                ? session
                : {
                    ...session,
                    // Explicit caller-set strictAgents (already on the session) wins
                    // over the store default. Otherwise inject the default so the
                    // value persists across save/load cycles.
                    strictAgents: session?.strictAgents
                        ?? defaults.strictAgents,
                };
            const parsed = sessionStateSchema.parse(merged);
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
// R6 — Helper for the CLI continue path: read the persisted strictAgents
// value from a session.json without instantiating the full runtime. Returns
// undefined for legacy sessions or when no session exists.
export async function loadPersistedStrictAgents(runDir) {
    try {
        const file = join(runDir, "session.json");
        const raw = await readFile(file, "utf8");
        const parsed = sessionStateSchema.parse(JSON.parse(raw));
        return parsed.strictAgents;
    }
    catch {
        return undefined;
    }
}
