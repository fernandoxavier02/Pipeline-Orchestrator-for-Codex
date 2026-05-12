import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const controllerPath = resolve(".kimi/skills/pipeline/agents/pipeline-controller.md");
const skillPath = resolve(".kimi/skills/pipeline/SKILL.md");
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

function getList(block: string, field: string): string[] {
  const lines = block.split("\n");
  const items: string[] = [];
  let inField = false;
  for (const line of lines) {
    if (line.match(new RegExp(`^${field}:\\s*`))) {
      inField = true;
      const inline = line.replace(new RegExp(`^${field}:\\s*`), "").trim();
      if (inline && inline !== "|") {
        // single-line array syntax not expected; treat as item if not starting [
        if (!inline.startsWith("[")) items.push(inline);
      }
      continue;
    }
    if (inField) {
      const itemMatch = line.match(/^\s*-\s+(.*)$/);
      if (itemMatch) {
        items.push(itemMatch[1].trim());
      } else if (!/^\s/.test(line) && line.trim().length > 0) {
        break;
      }
    }
  }
  return items;
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

describe("Protocol blocks — runtime contract", () => {
  describe("DISPATCH_REQUEST blocks in controller", () => {
    const blocks = extractBlocks(controllerContent, "DISPATCH_REQUEST");

    it("must contain at least 5 DISPATCH_REQUEST blocks", () => {
      expect(blocks.length).toBeGreaterThanOrEqual(5);
    });

    it("every block must have dispatch_id", () => {
      for (const block of blocks) {
        const val = getField(block, "dispatch_id");
        expect(val, `Missing dispatch_id`).toBeTruthy();
        expect(val!.length).toBeGreaterThan(3);
      }
    });

    it("every block must have target_type (coder or explore)", () => {
      for (const block of blocks) {
        const val = getField(block, "target_type");
        expect(val, `Missing target_type`).toMatch(/coder|explore/);
      }
    });

    it("every block must have description", () => {
      for (const block of blocks) {
        const val = getField(block, "description");
        expect(val, `Missing description`).toBeTruthy();
        expect(val!.length).toBeGreaterThan(5);
      }
    });

    it("every block must have prompt with > 50 chars (or be a template placeholder)", () => {
      for (const block of blocks) {
        const val = getField(block, "prompt");
        expect(val, `Missing prompt`).toBeTruthy();
        if (!val!.includes("<") && !val!.includes(">")) {
          expect(val!.length, `Prompt too short`).toBeGreaterThan(50);
        }
      }
    });
  });

  describe("GATE_REQUEST blocks in controller", () => {
    const blocks = extractBlocks(controllerContent, "GATE_REQUEST");

    it("must contain at least 3 GATE_REQUEST blocks", () => {
      expect(blocks.length).toBeGreaterThanOrEqual(3);
    });

    it("every block must have gate_id", () => {
      for (const block of blocks) {
        const val = getField(block, "gate_id");
        expect(val, `Missing gate_id`).toBeTruthy();
      }
    });

    it("every block must have question", () => {
      for (const block of blocks) {
        const val = getField(block, "question");
        expect(val, `Missing question`).toBeTruthy();
        expect(val!.length).toBeGreaterThan(5);
      }
    });

    it("every block must have at least 2 options", () => {
      for (const block of blocks) {
        expect(countOptions(block), `Need >= 2 options`).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe("PLAN_MODE_REQUEST blocks in controller", () => {
    const blocks = extractBlocks(controllerContent, "PLAN_MODE_REQUEST");

    it("must contain at least 1 PLAN_MODE_REQUEST block", () => {
      expect(blocks.length).toBeGreaterThanOrEqual(1);
    });

    it("every block must have plan_id", () => {
      for (const block of blocks) {
        const val = getField(block, "plan_id");
        expect(val, `Missing plan_id`).toBeTruthy();
      }
    });

    it("every block must have research_scope", () => {
      for (const block of blocks) {
        const val = getField(block, "research_scope");
        expect(val, `Missing research_scope`).toBeTruthy();
        if (!val!.includes("<") && !val!.includes(">")) {
          expect(val!.length).toBeGreaterThan(20);
        }
      }
    });

    it("every block must have expected_deliverables", () => {
      for (const block of blocks) {
        const items = getList(block, "expected_deliverables");
        expect(items.length, `Need >= 1 deliverable`).toBeGreaterThanOrEqual(1);
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

    it("must contain AWAITING_PLAN_MODE_RESULTS", () => {
      expect(controllerContent).toContain("STATUS: AWAITING_PLAN_MODE_RESULTS");
    });

    it("must contain PIPELINE COMPLETE", () => {
      expect(controllerContent).toContain("PIPELINE COMPLETE");
    });
  });

  describe("Response payload schemas in SKILL.md", () => {
    it("SKILL.md must define GATE_RESPONSES schema", () => {
      expect(skillContent).toContain("GATE_RESPONSES");
    });

    it("SKILL.md must define DISPATCH_RESULTS schema", () => {
      expect(skillContent).toContain("DISPATCH_RESULTS");
    });

    it("SKILL.md must define PLAN_MODE_RESULTS schema", () => {
      expect(skillContent).toContain("PLAN_MODE_RESULTS");
    });
  });
});
