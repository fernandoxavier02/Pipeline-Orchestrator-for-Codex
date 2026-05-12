import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const controllerPath = resolve("agents/core/pipeline-controller.md");
const skillPath = resolve("skills/pipeline/SKILL.md");
const controllerContent = readFileSync(controllerPath, "utf8");
const skillContent = readFileSync(skillPath, "utf8");

function extractBlocks(text: string, blockType: string) {
  const blocks: string[] = [];
  const regex = new RegExp(`=== ${blockType} v1 ===([\\s\\S]*?)=== END ${blockType} ===`, "g");
  let match;
  while ((match = regex.exec(text)) !== null) {
    blocks.push(match[1].trim());
  }
  return blocks;
}

function unquoteBlock(block: string): string {
  return block
    .split("\n")
    .map((line) => {
      if (line.startsWith("> ")) return line.slice(2);
      if (line.startsWith(">")) return line.slice(1);
      return line;
    })
    .join("\n");
}

function getField(block: string, field: string): string | null {
  const lines = block.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.match(new RegExp(`^${field}:\\s*`))) {
      const inline = line.replace(new RegExp(`^${field}:\\s*`), "").trim();
      if (inline !== "|") return inline;
      const parts: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j];
        if (next.length === 0) {
          parts.push("");
          continue;
        }
        if (/^\s/.test(next)) {
          parts.push(next.trimStart());
        } else {
          break;
        }
      }
      return parts.join("\n").trim();
    }
  }
  return null;
}

function countOptions(block: string): number {
  const lines = block.split("\n");
  let inOptions = false;
  let count = 0;
  for (const line of lines) {
    if (/^options:\s*/.test(line)) {
      inOptions = true;
      continue;
    }
    if (inOptions) {
      if (/^\s*-\s+label:/.test(line)) {
        count++;
      } else if (!/^\s/.test(line) && line.trim().length > 0) {
        break;
      }
    }
  }
  return count;
}

function isRealDispatchBlock(block: string): boolean {
  const unquoted = unquoteBlock(block);
  const id = getField(unquoted, "dispatch_id");
  return id !== null && !id.includes("<") && id.length > 3;
}

function isRealGateBlock(block: string): boolean {
  const unquoted = unquoteBlock(block);
  const id = getField(unquoted, "gate_id");
  return id !== null && !id.includes("<") && id.length > 3;
}

describe("Codex protocol blocks — runtime contract", () => {
  describe("DISPATCH_REQUEST blocks in controller", () => {
    const allBlocks = extractBlocks(controllerContent, "DISPATCH_REQUEST");
    const blocks = allBlocks.filter(isRealDispatchBlock);

    it("must contain at least 5 real DISPATCH_REQUEST blocks", () => {
      expect(blocks.length).toBeGreaterThanOrEqual(5);
    });

    it("every real block must have dispatch_id", () => {
      for (const block of blocks) {
        const val = getField(unquoteBlock(block), "dispatch_id");
        expect(val, `Missing dispatch_id`).toBeTruthy();
        expect(val!.length).toBeGreaterThan(3);
      }
    });

    it("every real block must have target_kind = agent", () => {
      for (const block of blocks) {
        const val = getField(unquoteBlock(block), "target_kind");
        expect(val, `Missing target_kind`).toBe("agent");
      }
    });

    it("every real block must have a valid target_name FQN", () => {
      for (const block of blocks) {
        const val = getField(unquoteBlock(block), "target_name");
        expect(val, `Missing target_name`).toBeTruthy();
        expect(val!).toMatch(/^pipeline-orchestrator-for-codex:[a-z-]+:[a-z0-9-]+$/);
      }
    });

    it("every real block must have description", () => {
      for (const block of blocks) {
        const val = getField(unquoteBlock(block), "description");
        expect(val, `Missing description`).toBeTruthy();
        expect(val!.length).toBeGreaterThan(5);
      }
    });

    it("every real block must have prompt with > 50 chars (or be a template placeholder)", () => {
      for (const block of blocks) {
        const val = getField(unquoteBlock(block), "prompt");
        expect(val, `Missing prompt`).toBeTruthy();
        if (!val!.includes("<") && !val!.includes(">")) {
          expect(val!.length, `Prompt too short`).toBeGreaterThan(50);
        }
      }
    });
  });

  describe("GATE_REQUEST blocks in controller", () => {
    const allBlocks = extractBlocks(controllerContent, "GATE_REQUEST");
    const blocks = allBlocks.filter(isRealGateBlock);

    it("must contain at least 2 real GATE_REQUEST blocks", () => {
      expect(blocks.length).toBeGreaterThanOrEqual(2);
    });

    it("every real block must have gate_id", () => {
      for (const block of blocks) {
        const val = getField(unquoteBlock(block), "gate_id");
        expect(val, `Missing gate_id`).toBeTruthy();
      }
    });

    it("every real block must have question", () => {
      for (const block of blocks) {
        const val = getField(unquoteBlock(block), "question");
        expect(val, `Missing question`).toBeTruthy();
        expect(val!.length).toBeGreaterThan(5);
      }
    });

    it("every real block must have at least 2 options", () => {
      for (const block of blocks) {
        expect(countOptions(block), `Need >= 2 options`).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe("STATUS lines in controller", () => {
    it("must contain AWAITING_GATE_RESPONSES", () => {
      expect(controllerContent).toContain("STATUS: AWAITING_GATE_RESPONSES");
    });

    it("must contain AWAITING_DISPATCH_RESULTS", () => {
      expect(controllerContent).toContain("STATUS: AWAITING_DISPATCH_RESULTS");
    });

    it("must contain PIPELINE COMPLETE", () => {
      expect(controllerContent).toContain("PIPELINE COMPLETE");
    });
  });

  describe("Protocol documentation in SKILL.md", () => {
    it("SKILL.md must mention DISPATCH_REQUEST protocol", () => {
      expect(skillContent).toContain("DISPATCH_REQUEST");
    });

    it("SKILL.md must mention GATE_REQUEST protocol", () => {
      expect(skillContent).toContain("GATE_REQUEST");
    });

    it("SKILL.md must mention PLAN_MODE_REQUEST protocol", () => {
      expect(skillContent).toContain("PLAN_MODE_REQUEST");
    });
  });
});
