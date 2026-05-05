import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "../../../src/state/atomic-write.js";

describe("writeFileAtomic", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "atomic-write-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates the file (and missing parents) with the supplied content", async () => {
    const file = join(dir, "nested", "out.json");
    await writeFileAtomic(file, '{"a":1}');
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toBe('{"a":1}');
  });

  it("overwrites an existing file and leaves no .tmp behind", async () => {
    const file = join(dir, "out.txt");
    writeFileSync(file, "old", "utf8");
    await writeFileAtomic(file, "new");
    expect(readFileSync(file, "utf8")).toBe("new");
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  it("supports concurrent writes to the same target without sharing one tmp path", async () => {
    const file = join(dir, "out.txt");
    const payloads = ["one", "two", "three", "four", "five"];

    await Promise.all(payloads.map((payload) => writeFileAtomic(file, payload)));

    expect(payloads).toContain(readFileSync(file, "utf8"));
    expect(readdirSync(dir).filter((name) => name.includes(".tmp"))).toEqual([]);
  });
});
