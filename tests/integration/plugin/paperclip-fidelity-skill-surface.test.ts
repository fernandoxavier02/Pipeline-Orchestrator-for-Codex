import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("Paperclip fidelity skill surface", () => {
  it("exposes the bundled Paperclip fidelity measurement as a public plugin skill", async () => {
    const skillPath = path.join(process.cwd(), "skills", "measure-paperclip-fidelity", "SKILL.md");
    const content = await readFile(skillPath, "utf8");

    expect(content).toContain("name: measure-paperclip-fidelity");
    expect(content).toContain("/pipeline-orchestrator-for-codex:measure-paperclip-fidelity");
    expect(content).toContain("../../references/paperclip/spec/lib/measure-fidelity.cjs");
    expect(content).toContain("^[A-Za-z0-9_-]{1,64}$");
    expect(content).toContain('node references/paperclip/spec/lib/measure-fidelity.cjs "$companyId"');
    expect(content).toContain("Do not paste an unvalidated `companyId` into a shell command.");
    expect(content).toContain("Do not create or mutate Paperclip cards from this skill.");
  });
});
