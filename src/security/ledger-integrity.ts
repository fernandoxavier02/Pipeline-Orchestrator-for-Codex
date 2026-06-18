import { createHmac, timingSafeEqual } from "node:crypto";

const PIPELINE_INTEGRITY_HMAC_ENV = "PIPELINE_INTEGRITY_HMAC_KEY";
const SENTINEL_HMAC_ENV = "PIPELINE_SENTINEL_HMAC_KEY";
const HMAC_SHA256_HEX_SIGNATURE = /^[0-9a-f]{64}$/iu;

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

function integrityKey() {
  return process.env[PIPELINE_INTEGRITY_HMAC_ENV] || process.env[SENTINEL_HMAC_ENV];
}

export function resolveSentinelIntegrityHmacKey() {
  return process.env[SENTINEL_HMAC_ENV] || process.env[PIPELINE_INTEGRITY_HMAC_ENV];
}

export function signLedgerEntry<T extends Record<string, unknown>>(entry: T): T {
  const key = integrityKey();
  if (!key) return entry;

  const unsignedEntry = { ...entry };
  delete unsignedEntry._integrity;
  return {
    ...unsignedEntry,
    _integrity: {
      algorithm: "hmac-sha256",
      scope: "pipeline-ledger-entry",
      signature: createHmac("sha256", key).update(canonicalize(unsignedEntry)).digest("hex"),
    },
  } as T;
}

export function ledgerEntryIntegrityVerified(entry: unknown): boolean {
  const key = integrityKey();
  if (!key || !entry || typeof entry !== "object" || Array.isArray(entry)) {
    return false;
  }

  const record = entry as Record<string, unknown>;
  const integrity = record._integrity && typeof record._integrity === "object" && !Array.isArray(record._integrity)
    ? record._integrity as Record<string, unknown>
    : undefined;
  if (
    !integrity
    || integrity.algorithm !== "hmac-sha256"
    || integrity.scope !== "pipeline-ledger-entry"
    || typeof integrity.signature !== "string"
    || !HMAC_SHA256_HEX_SIGNATURE.test(integrity.signature)
  ) {
    return false;
  }

  const unsignedEntry = { ...record };
  delete unsignedEntry._integrity;
  const expected = createHmac("sha256", key).update(canonicalize(unsignedEntry)).digest("hex");
  const expectedBytes = Buffer.from(expected, "hex");
  const actualBytes = Buffer.from(integrity.signature, "hex");
  return actualBytes.length > 0
    && expectedBytes.length === actualBytes.length
    && timingSafeEqual(expectedBytes, actualBytes);
}
