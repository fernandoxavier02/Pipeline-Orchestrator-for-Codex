import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ledgerEntryIntegrityVerified, signLedgerEntry } from "../../../src/security/ledger-integrity.js";

const TEST_HMAC_KEY = "ledger-integrity-test-key";
const ORIGINAL_PIPELINE_INTEGRITY_HMAC_KEY = process.env.PIPELINE_INTEGRITY_HMAC_KEY;

describe("ledger integrity", () => {
  beforeEach(() => {
    process.env.PIPELINE_INTEGRITY_HMAC_KEY = TEST_HMAC_KEY;
  });

  afterEach(() => {
    if (ORIGINAL_PIPELINE_INTEGRITY_HMAC_KEY === undefined) {
      delete process.env.PIPELINE_INTEGRITY_HMAC_KEY;
    } else {
      process.env.PIPELINE_INTEGRITY_HMAC_KEY = ORIGINAL_PIPELINE_INTEGRITY_HMAC_KEY;
    }
  });

  it("accepts a signed ledger entry", () => {
    const entry = signLedgerEntry({
      kind: "GATE_DECISION",
      gate: "CAPABILITY_GATE",
      status: "PASS",
    });

    expect(ledgerEntryIntegrityVerified(entry)).toBe(true);
  });

  it("rejects a signed ledger entry with a malformed HMAC signature", () => {
    const entry = signLedgerEntry({
      kind: "GATE_DECISION",
      gate: "CAPABILITY_GATE",
      status: "PASS",
    }) as Record<string, unknown>;
    const integrity = entry._integrity as { signature: string };

    entry._integrity = {
      ...integrity,
      signature: `${integrity.signature}zz`,
    };

    expect(ledgerEntryIntegrityVerified(entry)).toBe(false);
  });
});
