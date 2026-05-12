import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { gateDecisionSchema } from "../domain/pipeline-schemas.js";
import { createExecutionIdentity } from "../observability/execution-identity.js";
import { resolveValidatedRoot } from "./path-validation.js";
// Simple process-level mutex for concurrent append operations.
// This prevents JSONL line interleaving when multiple agents append simultaneously.
let appendMutex = Promise.resolve();
async function withAppendLock(fn) {
    const release = await appendMutex.then(() => {
        let resolve;
        const promise = new Promise((res) => { resolve = res; });
        appendMutex = appendMutex.then(() => promise);
        return resolve;
    });
    try {
        return await fn();
    }
    finally {
        release();
    }
}
export function createGateLog(root) {
    const validatedRoot = resolveValidatedRoot(root);
    const file = join(validatedRoot, "gate-decisions.jsonl");
    return {
        root: validatedRoot,
        async append(decision) {
            const parsed = gateDecisionSchema.parse(decision);
            const enriched = {
                ...parsed,
                execution_identity: parsed.execution_identity ?? createExecutionIdentity({
                    surface: "gate-log",
                    cwd: process.cwd(),
                    stateRoot: root,
                    source: "runtime",
                }),
            };
            await mkdir(root, { recursive: true });
            await withAppendLock(async () => {
                await appendFile(file, `${JSON.stringify(enriched)}\n`, "utf8");
            });
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
                    }
                    catch (jsonError) {
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
            }
            catch (error) {
                if (error instanceof Error && "code" in error && error.code === "ENOENT") {
                    return [];
                }
                throw error;
            }
        },
    };
}
