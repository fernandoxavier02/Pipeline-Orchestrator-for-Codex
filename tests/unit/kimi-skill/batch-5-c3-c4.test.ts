import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const skillPath = ".kimi/skills/pipeline/SKILL.md";
const controllerPath = ".kimi/skills/pipeline/agents/pipeline-controller.md";
const skillContent = readFileSync(skillPath, "utf8");
const controllerContent = readFileSync(controllerPath, "utf8");

const scriptsDir = ".kimi/skills/pipeline/scripts";

function scriptExists(name: string) {
  return existsSync(resolve(scriptsDir, name));
}

function readScript(name: string) {
  return readFileSync(resolve(scriptsDir, name), "utf8");
}

describe("Batch 5 — C3: Deterministic exec-window scripts", () => {
  it("open-exec-window.cjs must exist", () => {
    expect(scriptExists("open-exec-window.cjs"), "open-exec-window.cjs missing").toBe(true);
  });

  it("close-exec-window.cjs must exist", () => {
    expect(scriptExists("close-exec-window.cjs"), "close-exec-window.cjs missing").toBe(true);
  });

  it("validate-exec-window.cjs must exist", () => {
    expect(scriptExists("validate-exec-window.cjs"), "validate-exec-window.cjs missing").toBe(true);
  });

  it("open script must validate inputs (session_id, purpose)", () => {
    const script = readScript("open-exec-window.cjs");
    expect(script.toLowerCase()).toMatch(/session_id|sessionid|session-id/);
    expect(script.toLowerCase()).toMatch(/purpose/);
  });

  it("open script must write atomic JSON with TTL", () => {
    const script = readScript("open-exec-window.cjs");
    expect(script.toLowerCase()).toMatch(/ttl|expires|timeout/);
    expect(script.toLowerCase()).toMatch(/json|writefile|fs\.write/);
  });

  it("open script must append audit line", () => {
    const script = readScript("open-exec-window.cjs");
    expect(script.toLowerCase()).toMatch(/audit|log|append/);
  });

  it("validate script must check TTL bounds", () => {
    const script = readScript("validate-exec-window.cjs");
    expect(script.toLowerCase()).toMatch(/ttl|expires|valid|invalid/);
  });

  it("close script must clean up session file", () => {
    const script = readScript("close-exec-window.cjs");
    expect(script.toLowerCase()).toMatch(/unlink|rm|delete|remove/);
  });

  it("SKILL.md must instruct to run script instead of manual JSON write", () => {
    expect(skillContent.toLowerCase()).toMatch(/open-exec-window|node.*open|script.*exec/);
  });

  it("controller must not instruct manual JSON write for exec-window", () => {
    expect(controllerContent.toLowerCase()).not.toMatch(/write.*\.exec-window.*json|\.exec-window.*\{/);
  });

  it("controller must reference exec-window script", () => {
    expect(controllerContent.toLowerCase()).toMatch(/open-exec-window|script.*exec|shell.*exec/);
  });
});

describe("Batch 5 — C4: Compensating controls (no hooks)", () => {
  it("SKILL.md must validate file paths before allowing edits", () => {
    expect(skillContent.toLowerCase()).toMatch(/validate.*path|check.*path|path.*valid|whitelist|allow.*edit/);
  });

  it("SKILL.md must mention sentinel state validation", () => {
    expect(skillContent.toLowerCase()).toMatch(/sentinel.*state|sentinel-state|validate.*sentinel/);
  });

  it("SKILL.md must mention session lock / mutual exclusion", () => {
    expect(skillContent.toLowerCase()).toMatch(/session.lock|concurrent|mutual.exclusion|lock.file|only.one/);
  });

  it("SKILL.md must log gate decisions", () => {
    expect(skillContent.toLowerCase()).toMatch(/gate.*decision|gate-decisions|decision.log/);
  });

  it("controller must reference sentinel-state.json", () => {
    expect(controllerContent.toLowerCase()).toMatch(/sentinel-state|sentinel.*state/);
  });

  it("controller must enforce edit scope (only .pipeline/ without exec-window)", () => {
    expect(controllerContent.toLowerCase()).toMatch(/edit.*outside|outside.*\.pipeline|exec-window.*required|only.*\.pipeline/);
  });
});
