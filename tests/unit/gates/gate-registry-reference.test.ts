import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createGateRegistry } from "../../../src/gates/gate-registry.js";

type GateReferenceRow = {
  gate: string;
  hardness: string;
  phase: string;
  defaultDecision: string;
  rollback: string;
};

function parseReferenceRows(markdown: string): GateReferenceRow[] {
  const normalizedMarkdown = markdown.replace(/\r\n/g, "\n");
  const inventorySection = normalizedMarkdown
    .split("## Inventory\n")[1]
    ?.split("\n## Wave 1 Delta")[0];

  if (!inventorySection) {
    throw new Error("references/gates.md is missing the ## Inventory section");
  }

  return inventorySection
    .split("\n")
    .filter((line) => line.startsWith("| `"))
    .map((line) => {
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim().replace(/^`|`$/g, ""));

      return {
        gate: cells[0],
        hardness: cells[1],
        phase: cells[2],
        defaultDecision: cells[3],
        rollback: cells[4],
      };
    });
}

describe("gate registry reference inventory", () => {
  it("keeps references/gates.md aligned with the typed gate registry", async () => {
    const markdown = await readFile("references/gates.md", "utf8");
    const referenceRows = parseReferenceRows(markdown);
    const registryRows = createGateRegistry()
      .list()
      .map((entry) => ({
        gate: entry.gate,
        hardness: entry.hardness,
        phase: entry.phase,
        defaultDecision: entry.defaultDecision,
        rollback: entry.rollback,
      }))
      .sort((a, b) => a.gate.localeCompare(b.gate));

    expect(referenceRows).toEqual(registryRows);
    expect(referenceRows).toHaveLength(registryRows.length);
  });
});
