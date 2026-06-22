import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { join } from "node:path";
import { sentinelStateReadSchema, sentinelStateSchema } from "../domain/pipeline-schemas.js";
import { resolveSentinelIntegrityHmacKey } from "../security/ledger-integrity.js";
function canonicalize(value) {
    if (Array.isArray(value)) {
        return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
    }
    if (value && typeof value === "object") {
        const entries = Object.entries(value)
            .filter(([, entry]) => entry !== undefined)
            .sort(([left], [right]) => left.localeCompare(right));
        return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(",")}}`;
    }
    return JSON.stringify(value);
}
function withIntegrity(state) {
    const key = resolveSentinelIntegrityHmacKey();
    if (!key)
        return state;
    return {
        ...state,
        _integrity: {
            algorithm: "hmac-sha256",
            signature: createHmac("sha256", key).update(canonicalize(state)).digest("hex"),
        },
    };
}
export function createSentinelStateStore(root) {
    const file = join(root, "sentinel-state.json");
    return {
        root,
        async save(state) {
            const parsed = sentinelStateSchema.parse(state);
            await mkdir(root, { recursive: true });
            await writeFile(file, JSON.stringify(withIntegrity(parsed)), "utf8");
        },
        async load() {
            const raw = await readFile(file, "utf8");
            const parsed = sentinelStateReadSchema.parse(JSON.parse(raw));
            if (parsed.runtime_mode === "pending-real-agent") {
                const { runtime_mode: _legacyRuntimeMode, ...strictState } = parsed;
                return sentinelStateSchema.parse(strictState);
            }
            return sentinelStateSchema.parse(parsed);
        },
    };
}
