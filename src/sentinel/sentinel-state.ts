import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { join } from "node:path";
import { sentinelStateSchema } from "../domain/pipeline-schemas.js";
import { resolveSentinelIntegrityHmacKey } from "../security/ledger-integrity.js";

export type SentinelState = ReturnType<typeof sentinelStateSchema.parse>;

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(",")}}`;
  }

  return JSON.stringify(value);
}

function withIntegrity(state: SentinelState) {
  const key = resolveSentinelIntegrityHmacKey();
  if (!key) return state;

  return {
    ...state,
    _integrity: {
      algorithm: "hmac-sha256",
      signature: createHmac("sha256", key).update(canonicalize(state)).digest("hex"),
    },
  };
}

export function createSentinelStateStore(root: string) {
  const file = join(root, "sentinel-state.json");

  return {
    root,
    async save(state: unknown) {
      const parsed = sentinelStateSchema.parse(state);
      await mkdir(root, { recursive: true });
      await writeFile(file, JSON.stringify(withIntegrity(parsed)), "utf8");
    },
    async load() {
      const raw = await readFile(file, "utf8");
      return sentinelStateSchema.parse(JSON.parse(raw));
    },
  };
}
