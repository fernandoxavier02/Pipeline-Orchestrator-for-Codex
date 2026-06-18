import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sessionStateSchema } from "../domain/pipeline-schemas.js";
import { createExecutionIdentity } from "../observability/execution-identity.js";
import { writeFileAtomic } from "./atomic-write.js";
import { resolveValidatedRoot } from "./path-validation.js";

// Spec: pipeline-trust-restoration / R6 — Resume Preserves strictAgents.
// The session store can be constructed with default fields that are auto-injected
// into every save. Callers that hold the RuntimeOptions (CLI, controller) pass
// `strictAgents` so the persisted session.json carries the value across the
// resume boundary. Legacy sessions (no field) parse fine and fall back to the
// cascade — see resolveRequireRealAgent (src/runtime/strict-resolution.ts).
//
// Post-review note (ARCH-005): coupling the persistence layer to a runtime
// concern is a known design trade-off. The cleaner alternative is a decorator
// pattern (SessionStoreWithStrictAgents) or explicit merge at the save site.
// The current shape is acceptable because (a) only ONE store per root is
// active at a time in practice and (b) the store's save method preserves the
// session's own `strictAgents` over the default (see merge logic below) so
// caller-provided values are never overridden. If two stores ever target the
// same root with conflicting defaults, the LAST save wins — document this as
// an unsupported configuration in operational docs rather than fixing it
// architecturally for v0.5.0.
export interface SessionStoreDefaults {
  strictAgents?: boolean;
}

export function createSessionStore(
  root: string,
  defaults: SessionStoreDefaults = {},
) {
  const validatedRoot = resolveValidatedRoot(root);
  const file = join(validatedRoot, "session.json");

  return {
    root: validatedRoot,
    async save(session: unknown) {
      let priorIdentity: Record<string, unknown> = {};
      try {
        const prior = sessionStateSchema.parse(JSON.parse(await readFile(file, "utf8")));
        priorIdentity = {
          sessionId: prior.sessionId,
          ...(prior.run_id ? { run_id: prior.run_id } : {}),
          ...(prior.runtime_mode ? { runtime_mode: prior.runtime_mode } : {}),
        };
      } catch {
        priorIdentity = {};
      }
      const sessionRecord = session as Record<string, unknown>;
      const identityPreservingSession: Record<string, unknown> = {
        ...priorIdentity,
        ...sessionRecord,
        run_id: sessionRecord.run_id ?? priorIdentity.run_id,
        runtime_mode: sessionRecord.runtime_mode ?? priorIdentity.runtime_mode,
      };
      const merged = defaults.strictAgents === undefined
        ? identityPreservingSession
        : {
            ...identityPreservingSession,
            // Explicit caller-set strictAgents (already on the session) wins
            // over the store default. Otherwise inject the default so the
            // value persists across save/load cycles.
            strictAgents:
              identityPreservingSession.strictAgents
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
export async function loadPersistedStrictAgents(runDir: string): Promise<boolean | undefined> {
  try {
    const file = join(runDir, "session.json");
    const raw = await readFile(file, "utf8");
    const parsed = sessionStateSchema.parse(JSON.parse(raw));
    return parsed.strictAgents;
  } catch {
    return undefined;
  }
}
