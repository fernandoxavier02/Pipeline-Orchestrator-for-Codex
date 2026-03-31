# Pipeline Orchestrator for Codex Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for same-session execution or superpowers:executing-plans for fresh-session execution from this document. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Codex-native `Pipeline-Orchestrator` with functional parity for controller orchestration, persistent state, gate management, dispatcher behavior, prompt registry, continue mode, batch execution, adversarial review, and final validation.

**Architecture:** Implement the port as a TypeScript runtime with filesystem-backed state, markdown prompt assets, and a Codex plugin shell. Keep controller logic deterministic, treat prompts as role definitions rather than control flow, and support both single-agent emulation and future multi-agent dispatch behind the same runtime interfaces.

**Tech Stack:** Node.js 20, TypeScript, Vitest, Zod, YAML, Codex plugin manifest, Markdown prompt assets

---

## Assumptions

- The current repository is intentionally minimal, so this plan starts by scaffolding the runtime from scratch.
- The first usable release defaults to single-agent emulation mode and keeps multi-agent dispatch as an interface, not a hard dependency.
- Filesystem state under `.codex/pipeline/` is the source of truth for `continue`.
- Prompt assets are versioned in-repo and loaded through a registry instead of being embedded inline in code.
- Adversarial review is mandatory at the end of every batch before commit.

## Proposed Runtime Layout

- `.codex-plugin/plugin.json`
  Responsibility: Codex plugin metadata and package entry wiring.
- `package.json`
  Responsibility: scripts, dependencies, and test commands.
- `tsconfig.json`
  Responsibility: strict TypeScript compilation rules.
- `vitest.config.ts`
  Responsibility: unit and integration test configuration.
- `src/index.ts`
  Responsibility: public runtime entrypoint.
- `src/domain/pipeline-types.ts`
  Responsibility: canonical enums and interfaces for phases, modes, variants, gates, state, and review outputs.
- `src/domain/pipeline-schemas.ts`
  Responsibility: Zod validation for persisted runtime files.
- `src/controller/*`
  Responsibility: request parsing, classification, proposal building, phase routing.
- `src/state/*`
  Responsibility: session storage, checkpoint storage, gate log, confidence score persistence.
- `src/gates/*`
  Responsibility: macro gate, micro gate, hardness policy, gate result evaluation.
- `src/dispatcher/*`
  Responsibility: role dispatch abstraction, single-agent emulation runner, future multi-agent adapter.
- `src/prompts/prompt-registry.ts`
  Responsibility: load and validate markdown prompt assets.
- `prompts/**/*`
  Responsibility: controller and role prompt files.
- `src/continue/*`
  Responsibility: state restoration and safe resume routing.
- `src/execution/*`
  Responsibility: batch planning and execution loop.
- `src/review/*`
  Responsibility: adversarial review orchestration.
- `src/validation/*`
  Responsibility: checkpoint and final validation.
- `src/closeout/*`
  Responsibility: closeout rendering and final summary formatting.
- `tests/unit/**/*`
  Responsibility: fast deterministic behavior checks.
- `tests/integration/**/*`
  Responsibility: scenario coverage for full pipeline flow.

## Batch Order

1. Foundation and repo scaffold
2. Controller core
3. Persistent state
4. Gates and hardness
5. Dispatcher abstraction
6. Prompt registry
7. Continue mode
8. Execution, adversarial review, and final validation
9. Productization and scenario coverage

## Batch Review Protocol

Every batch ends with the same release gate:

1. run the narrow test suite for that batch
2. run the broad regression suite
3. inspect `git diff --stat`
4. perform adversarial review against the batch checklist
5. fix blocking or important findings
6. only then commit

Use this adversarial checklist at the end of each batch:

- Did this batch introduce control flow that belongs in the controller but lives somewhere else?
- Did this batch add a persisted field without schema validation and tests?
- Did this batch introduce a prompt contract that code does not validate?
- Did this batch add a branch in the runtime without a failing test first?
- Did this batch leak implementation rationale into an allegedly independent review path?
- Did this batch make `continue` less trustworthy by hiding state mutations?

---

### Task 1: Foundation and Repository Scaffold

**Files:**
- Create: `.codex-plugin/plugin.json`
- Create: `hooks/hooks.json`
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `skills/pipeline/SKILL.md`
- Create: `src/index.ts`
- Create: `src/domain/pipeline-types.ts`
- Create: `tests/integration/bootstrap.test.ts`

- [ ] **Step 1: Write the failing bootstrap test**

```ts
// tests/integration/bootstrap.test.ts
import { describe, expect, it } from "vitest";
import { createPipelineRuntime } from "../../src/index";

describe("bootstrap", () => {
  it("creates a runtime with default directories and mode support", () => {
    const runtime = createPipelineRuntime({
      cwd: "/tmp/repo",
      codexHome: "/tmp/codex-home",
    });

    expect(runtime.controller).toBeDefined();
    expect(runtime.stateDir).toContain(".codex/pipeline");
    expect(runtime.supportedModes).toEqual(
      expect.arrayContaining(["full", "diagnostic", "continue", "review-only"]),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand`
Expected: FAIL with missing `package.json`, missing `src/index.ts`, or unresolved import errors.

- [ ] **Step 3: Create package manifest and scripts**

```json
{
  "name": "pipeline-orchestrator-for-codex",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint:types": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "yaml": "^2.8.1",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "typescript": "^5.8.3",
    "vitest": "^3.2.4"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 4: Create TypeScript and test configuration**

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "rootDir": ".",
    "outDir": "dist",
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"]
}
```

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
```

```gitignore
# .gitignore
node_modules/
dist/
coverage/
.codex/pipeline/
```

- [ ] **Step 5: Create Codex plugin manifest**

```json
{
  "name": "pipeline-orchestrator-for-codex",
  "version": "0.1.0",
  "description": "Structured multi-phase execution pipeline for Codex with gates, state, and adversarial review.",
  "author": {
    "name": "Fernando Xavier - FX Studio AI",
    "email": "",
    "url": ""
  },
  "homepage": "https://github.com/fernandoxavier02/Pipeline-Orchestrator-for-Codex",
  "repository": "https://github.com/fernandoxavier02/Pipeline-Orchestrator-for-Codex",
  "license": "MIT",
  "keywords": ["codex", "pipeline", "orchestration", "review", "workflow"],
  "skills": "./skills/",
  "hooks": "./hooks/hooks.json",
  "interface": {
    "displayName": "Pipeline Orchestrator for Codex",
    "shortDescription": "Structured execution pipeline with gates and review",
    "longDescription": "Functional Codex port of the original Claude Code Pipeline-Orchestrator.",
    "developerName": "Fernando Xavier - FX Studio AI",
    "category": "Coding",
    "capabilities": ["Interactive", "Write"],
    "websiteURL": "https://github.com/fernandoxavier02/Pipeline-Orchestrator-for-Codex",
    "privacyPolicyURL": "https://github.com/fernandoxavier02/Pipeline-Orchestrator-for-Codex/blob/main/README.md",
    "termsOfServiceURL": "https://github.com/fernandoxavier02/Pipeline-Orchestrator-for-Codex/blob/main/LICENSE",
    "defaultPrompt": [
      "Run the pipeline for this repository.",
      "Classify the request, show the proposal, then execute in phases."
    ],
    "brandColor": "#14532D",
    "screenshots": []
  }
}
```

- [ ] **Step 6: Create domain types and runtime bootstrap**

```ts
// src/domain/pipeline-types.ts
export type PipelineMode =
  | "full"
  | "diagnostic"
  | "continue"
  | "review-only"
  | "--plan"
  | "--grill"
  | "--hotfix";

export type PipelinePhase = "phase-0" | "phase-1" | "phase-1.5" | "phase-2" | "phase-3";

export type PipelineVariant =
  | "implement-light"
  | "implement-heavy"
  | "bugfix-light"
  | "bugfix-heavy"
  | "audit-light"
  | "audit-heavy"
  | "user-story-light"
  | "user-story-heavy"
  | "ux-sim-light"
  | "ux-sim-heavy";

export interface RuntimeOptions {
  cwd: string;
  codexHome: string;
}
```

```json
// hooks/hooks.json
{
  "hooks": []
}
```

```md
<!-- skills/pipeline/SKILL.md -->
---
name: pipeline
description: Minimal scaffold for the Codex pipeline skill so plugin paths resolve from the first batch.
---

# Pipeline

This minimal scaffold exists so the plugin manifest never points to a missing path during early batches.
```

```ts
// src/index.ts
import type { PipelineMode, RuntimeOptions } from "./domain/pipeline-types.js";

const SUPPORTED_MODES: PipelineMode[] = [
  "full",
  "diagnostic",
  "continue",
  "review-only",
  "--plan",
  "--grill",
  "--hotfix",
];

export function createPipelineRuntime(options: RuntimeOptions) {
  return {
    controller: {},
    stateDir: `${options.cwd}/.codex/pipeline`,
    supportedModes: SUPPORTED_MODES,
  };
}
```

- [ ] **Step 7: Install dependencies and run tests until green**

Run: `npm install`
Run: `npm test`
Expected: PASS for `tests/integration/bootstrap.test.ts`

- [ ] **Step 8: Run adversarial batch review**

Run: `npm test && npm run lint:types`
Run: `git diff --stat`
Expected: only scaffold files plus the bootstrap test
Challenge:
- Is any mode enum duplicated in more than one file?
- Is the plugin manifest pointing to folders that do not exist yet?
- Did the bootstrap API expose more than the next batch needs?

- [ ] **Step 9: Commit**

```bash
git add .codex-plugin/plugin.json hooks/hooks.json package.json tsconfig.json vitest.config.ts .gitignore skills/pipeline/SKILL.md src/index.ts src/domain/pipeline-types.ts tests/integration/bootstrap.test.ts
git commit -m "chore: scaffold codex pipeline runtime"
```

### Task 2: Controller Core

**Files:**
- Create: `src/domain/pipeline-schemas.ts`
- Create: `src/controller/parse-mode.ts`
- Create: `src/controller/classify-request.ts`
- Create: `src/controller/build-proposal.ts`
- Create: `src/controller/pipeline-controller.ts`
- Create: `tests/unit/controller/pipeline-controller.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing controller tests**

```ts
// tests/unit/controller/pipeline-controller.test.ts
import { describe, expect, it } from "vitest";
import { createPipelineRuntime } from "../../../src/index";

describe("pipeline controller", () => {
  const runtime = createPipelineRuntime({
    cwd: "/repo",
    codexHome: "/codex-home",
  });

  it("parses diagnostic mode from command-like input", async () => {
    const result = await runtime.controller.start("/pipeline diagnostic audit auth flow");
    expect(result.mode).toBe("diagnostic");
    expect(result.type).toBe("Audit");
  });

  it("builds a visible proposal before execution", async () => {
    const result = await runtime.controller.start("fix login redirect loop");
    expect(result.proposal.summary).toContain("fix login redirect loop");
    expect(result.proposal.variant).toMatch(/bugfix/);
    expect(result.proposal.awaitingUserConfirmation).toBe(true);
  });
});
```

- [ ] **Step 2: Run controller tests to verify they fail**

Run: `npm test -- tests/unit/controller/pipeline-controller.test.ts`
Expected: FAIL because `controller.start` does not exist yet.

- [ ] **Step 3: Define schemas for normalized controller output**

```ts
// src/domain/pipeline-schemas.ts
import { z } from "zod";

export const orchestratorDecisionSchema = z.object({
  mode: z.string(),
  type: z.enum(["Bug Fix", "Feature", "User Story", "Audit", "UX Simulation"]),
  complexity: z.enum(["SIMPLES", "MEDIA", "COMPLEXA"]),
  variant: z.string(),
  summary: z.string(),
  affectedFiles: z.array(z.string()),
});

export const proposalSchema = z.object({
  summary: z.string(),
  variant: z.string(),
  awaitingUserConfirmation: z.boolean(),
  affectedFiles: z.array(z.string()),
});
```

- [ ] **Step 4: Implement mode parsing and request classification**

```ts
// src/controller/parse-mode.ts
import type { PipelineMode } from "../domain/pipeline-types.js";

export function parseMode(input: string): { mode: PipelineMode; normalizedRequest: string } {
  if (input.startsWith("/pipeline diagnostic ")) {
    return { mode: "diagnostic", normalizedRequest: input.replace("/pipeline diagnostic ", "") };
  }

  if (input.startsWith("/pipeline continue")) {
    return { mode: "continue", normalizedRequest: "" };
  }

  if (input.startsWith("/pipeline review-only ")) {
    return { mode: "review-only", normalizedRequest: input.replace("/pipeline review-only ", "") };
  }

  return { mode: "full", normalizedRequest: input.replace("/pipeline ", "") };
}
```

```ts
// src/controller/classify-request.ts
export function classifyRequest(request: string) {
  const lower = request.toLowerCase();

  if (lower.includes("audit")) {
    return { type: "Audit", complexity: "MEDIA", variant: "audit-heavy" };
  }

  if (lower.includes("fix") || lower.includes("bug")) {
    return { type: "Bug Fix", complexity: "MEDIA", variant: "bugfix-heavy" };
  }

  if (lower.includes("story")) {
    return { type: "User Story", complexity: "COMPLEXA", variant: "user-story-heavy" };
  }

  return { type: "Feature", complexity: "MEDIA", variant: "implement-heavy" };
}
```

- [ ] **Step 5: Implement proposal builder and controller**

```ts
// src/controller/build-proposal.ts
export function buildProposal(request: string, classification: { variant: string }) {
  return {
    summary: request,
    variant: classification.variant,
    awaitingUserConfirmation: true,
    affectedFiles: [],
  };
}
```

```ts
// src/controller/pipeline-controller.ts
import { buildProposal } from "./build-proposal.js";
import { classifyRequest } from "./classify-request.js";
import { parseMode } from "./parse-mode.js";

export function createPipelineController() {
  return {
    async start(input: string) {
      const { mode, normalizedRequest } = parseMode(input);
      const classification = classifyRequest(normalizedRequest);
      const proposal = buildProposal(normalizedRequest, classification);

      return {
        mode,
        type: classification.type,
        complexity: classification.complexity,
        variant: classification.variant,
        proposal,
      };
    },
  };
}
```

```ts
// src/index.ts
import { createPipelineController } from "./controller/pipeline-controller.js";
import type { PipelineMode, RuntimeOptions } from "./domain/pipeline-types.js";

const SUPPORTED_MODES: PipelineMode[] = [
  "full",
  "diagnostic",
  "continue",
  "review-only",
  "--plan",
  "--grill",
  "--hotfix",
];

export function createPipelineRuntime(options: RuntimeOptions) {
  return {
    controller: createPipelineController(),
    stateDir: `${options.cwd}/.codex/pipeline`,
    supportedModes: SUPPORTED_MODES,
  };
}
```

- [ ] **Step 6: Run controller tests until green**

Run: `npm test -- tests/unit/controller/pipeline-controller.test.ts`
Expected: PASS

- [ ] **Step 7: Run adversarial batch review**

Run: `npm test && npm run lint:types`
Run: `git diff --stat HEAD~1`
Challenge:
- Did we overfit classification to keywords without leaving a clear upgrade seam?
- Does the controller return proposal state instead of directly executing?
- Is `diagnostic` truly non-destructive at this stage?

- [ ] **Step 8: Commit**

```bash
git add src/domain/pipeline-schemas.ts src/controller/parse-mode.ts src/controller/classify-request.ts src/controller/build-proposal.ts src/controller/pipeline-controller.ts src/index.ts tests/unit/controller/pipeline-controller.test.ts
git commit -m "feat: add controller classification and proposal flow"
```

### Task 3: Persistent State Layer

**Files:**
- Create: `src/state/session-store.ts`
- Create: `src/state/checkpoint-store.ts`
- Create: `src/state/gate-log.ts`
- Create: `src/state/confidence-score.ts`
- Create: `tests/unit/state/session-store.test.ts`
- Create: `tests/unit/state/gate-log.test.ts`
- Modify: `src/domain/pipeline-schemas.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing state tests**

```ts
// tests/unit/state/session-store.test.ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionStore } from "../../../src/state/session-store";

describe("session store", () => {
  it("persists session state as validated JSON", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-state-"));
    const store = createSessionStore(root);

    await store.save({
      sessionId: "session-1",
      currentPhase: "phase-1",
      mode: "full",
      variant: "implement-heavy",
      confidenceScore: 1,
    });

    const raw = readFileSync(join(root, "session.json"), "utf8");
    expect(raw).toContain("\"sessionId\":\"session-1\"");
  });
});
```

```ts
// tests/unit/state/gate-log.test.ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGateLog } from "../../../src/state/gate-log";

describe("gate log", () => {
  it("appends jsonl gate decisions", async () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-gates-"));
    const log = createGateLog(root);

    await log.append({
      gate: "INFO_GATE_BLOCKED",
      status: "blocked",
      hardness: "MANDATORY",
      reason: "Missing reproduction steps",
    });

    const raw = readFileSync(join(root, "gate-decisions.jsonl"), "utf8");
    expect(raw).toContain("\"gate\":\"INFO_GATE_BLOCKED\"");
  });
});
```

- [ ] **Step 2: Run state tests to verify they fail**

Run: `npm test -- tests/unit/state/session-store.test.ts tests/unit/state/gate-log.test.ts`
Expected: FAIL because state modules do not exist yet.

- [ ] **Step 3: Expand schemas to cover persisted files**

```ts
// add to src/domain/pipeline-schemas.ts
export const sessionStateSchema = z.object({
  sessionId: z.string(),
  currentPhase: z.enum(["phase-0", "phase-1", "phase-1.5", "phase-2", "phase-3"]),
  mode: z.string(),
  variant: z.string(),
  confidenceScore: z.number(),
});

export const gateDecisionSchema = z.object({
  gate: z.string(),
  status: z.enum(["passed", "blocked", "partial"]),
  hardness: z.enum(["MANDATORY", "HARD", "CIRCUIT_BREAKER", "SOFT"]),
  reason: z.string(),
});
```

- [ ] **Step 4: Implement session, checkpoint, gate-log, and confidence writers**

```ts
// src/state/session-store.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sessionStateSchema } from "../domain/pipeline-schemas.js";

export function createSessionStore(root: string) {
  const file = join(root, "session.json");

  return {
    async save(session: unknown) {
      const parsed = sessionStateSchema.parse(session);
      await mkdir(root, { recursive: true });
      await writeFile(file, JSON.stringify(parsed), "utf8");
    },
    async load() {
      const raw = await readFile(file, "utf8");
      return sessionStateSchema.parse(JSON.parse(raw));
    },
  };
}
```

```ts
// src/state/gate-log.ts
import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { gateDecisionSchema } from "../domain/pipeline-schemas.js";

export function createGateLog(root: string) {
  const file = join(root, "gate-decisions.jsonl");

  return {
    async append(entry: unknown) {
      const parsed = gateDecisionSchema.parse(entry);
      await mkdir(root, { recursive: true });
      await appendFile(file, `${JSON.stringify(parsed)}\n`, "utf8");
    },
  };
}
```

```ts
// src/state/checkpoint-store.ts
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function createCheckpointStore(root: string) {
  const dir = join(root, "checkpoints");

  return {
    async save(name: string, payload: unknown) {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${name}.json`), JSON.stringify(payload), "utf8");
    },
    async list() {
      await mkdir(dir, { recursive: true });
      const files = await readdir(dir);
      return Promise.all(
        files.map(async (file) => ({
          name: file.replace(/\.json$/, ""),
          ...(JSON.parse(await readFile(join(dir, file), "utf8")) as Record<string, unknown>),
        })),
      );
    },
  };
}
```

```ts
// src/state/confidence-score.ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";

export function createConfidenceScoreStore(root: string) {
  const file = join(root, "confidence-score.yaml");

  return {
    async save(score: number, reasons: string[]) {
      await mkdir(root, { recursive: true });
      await writeFile(file, YAML.stringify({ score, reasons }), "utf8");
    },
  };
}
```

- [ ] **Step 5: Wire state helpers into runtime bootstrap**

```ts
// update src/index.ts
import { createPipelineController } from "./controller/pipeline-controller.js";
import type { PipelineMode, RuntimeOptions } from "./domain/pipeline-types.js";
import { createCheckpointStore } from "./state/checkpoint-store.js";
import { createConfidenceScoreStore } from "./state/confidence-score.js";
import { createGateLog } from "./state/gate-log.js";
import { createSessionStore } from "./state/session-store.js";

const SUPPORTED_MODES: PipelineMode[] = [
  "full",
  "diagnostic",
  "continue",
  "review-only",
  "--plan",
  "--grill",
  "--hotfix",
];

export function createPipelineRuntime(options: RuntimeOptions) {
  const stateDir = `${options.cwd}/.codex/pipeline`;

  return {
    controller: createPipelineController(),
    stateDir,
    supportedModes: SUPPORTED_MODES,
    stores: {
      session: createSessionStore(stateDir),
      checkpoints: createCheckpointStore(stateDir),
      gateLog: createGateLog(stateDir),
      confidence: createConfidenceScoreStore(stateDir),
    },
  };
}
```

- [ ] **Step 6: Run state tests until green**

Run: `npm test -- tests/unit/state/session-store.test.ts tests/unit/state/gate-log.test.ts`
Expected: PASS

- [ ] **Step 7: Run adversarial batch review**

Run: `npm test && npm run lint:types`
Run: `git diff --stat HEAD~1`
Challenge:
- Can every persisted file be reconstructed by schema, not assumptions?
- Is confidence score stored separately from session state as the spec requires?
- Are checkpoints append-safe and phase-oriented?

- [ ] **Step 8: Commit**

```bash
git add src/state/session-store.ts src/state/checkpoint-store.ts src/state/gate-log.ts src/state/confidence-score.ts src/domain/pipeline-schemas.ts src/index.ts tests/unit/state/session-store.test.ts tests/unit/state/gate-log.test.ts
git commit -m "feat: add persistent runtime state stores"
```

### Task 4: Gates and Hardness Engine

**Files:**
- Create: `src/gates/gate-types.ts`
- Create: `src/gates/hardness-policy.ts`
- Create: `src/gates/information-gate.ts`
- Create: `src/gates/micro-gate.ts`
- Create: `tests/unit/gates/information-gate.test.ts`
- Create: `tests/unit/gates/hardness-policy.test.ts`
- Modify: `src/controller/pipeline-controller.ts`

- [ ] **Step 1: Write failing gate tests**

```ts
// tests/unit/gates/hardness-policy.test.ts
import { describe, expect, it } from "vitest";
import { classifyGateHardness } from "../../../src/gates/hardness-policy";

describe("hardness policy", () => {
  it("maps missing blocker context to MANDATORY", () => {
    expect(classifyGateHardness({ blocker: true, severity: "high" })).toBe("MANDATORY");
  });

  it("maps non-blocking polish concerns to SOFT", () => {
    expect(classifyGateHardness({ blocker: false, severity: "low" })).toBe("SOFT");
  });
});
```

```ts
// tests/unit/gates/information-gate.test.ts
import { describe, expect, it } from "vitest";
import { runInformationGate } from "../../../src/gates/information-gate";

describe("information gate", () => {
  it("blocks when reproduction steps are required for a bugfix", () => {
    const result = runInformationGate({
      request: "fix checkout timeout",
      classification: { type: "Bug Fix", complexity: "MEDIA" },
      knownFacts: [],
    });

    expect(result.status).toBe("blocked");
    expect(result.questions[0]).toContain("reproduction");
  });
});
```

- [ ] **Step 2: Run gate tests to verify they fail**

Run: `npm test -- tests/unit/gates/hardness-policy.test.ts tests/unit/gates/information-gate.test.ts`
Expected: FAIL due to missing gate modules.

- [ ] **Step 3: Define gate types and hardness policy**

```ts
// src/gates/gate-types.ts
export type GateHardness = "MANDATORY" | "HARD" | "CIRCUIT_BREAKER" | "SOFT";
export type GateStatus = "passed" | "blocked" | "partial";

export interface GateResult {
  gate: string;
  status: GateStatus;
  hardness: GateHardness;
  reason: string;
  questions: string[];
}
```

```ts
// src/gates/hardness-policy.ts
import type { GateHardness } from "./gate-types.js";

export function classifyGateHardness(input: { blocker: boolean; severity: "low" | "medium" | "high" }): GateHardness {
  if (input.blocker && input.severity === "high") {
    return "MANDATORY";
  }

  if (input.blocker) {
    return "HARD";
  }

  if (input.severity === "high") {
    return "CIRCUIT_BREAKER";
  }

  return "SOFT";
}
```

- [ ] **Step 4: Implement macro and micro gate runners**

```ts
// src/gates/information-gate.ts
import type { GateResult } from "./gate-types.js";
import { classifyGateHardness } from "./hardness-policy.js";

export function runInformationGate(input: {
  request: string;
  classification: { type: string; complexity: string };
  knownFacts: string[];
}): GateResult {
  const needsReproduction = input.classification.type === "Bug Fix" && input.knownFacts.length === 0;

  if (needsReproduction) {
    return {
      gate: "INFO_GATE_BLOCKED",
      status: "blocked",
      hardness: classifyGateHardness({ blocker: true, severity: "high" }),
      reason: "Missing reproduction steps",
      questions: ["What are the reproduction steps for this bug?"],
    };
  }

  return {
    gate: "INFO_GATE_OK",
    status: "passed",
    hardness: "SOFT",
    reason: "Enough information to continue",
    questions: [],
  };
}
```

```ts
// src/gates/micro-gate.ts
import type { GateResult } from "./gate-types.js";

export function runMicroGate(input: { hasTests: boolean; hasUnresolvedFindings: boolean }): GateResult {
  if (!input.hasTests) {
    return {
      gate: "TDD_APPROVAL",
      status: "blocked",
      hardness: "HARD",
      reason: "Batch has no test evidence",
      questions: ["Which failing test proves the batch requirement?"],
    };
  }

  return {
    gate: "MICRO_GATE_OK",
    status: input.hasUnresolvedFindings ? "partial" : "passed",
    hardness: input.hasUnresolvedFindings ? "HARD" : "SOFT",
    reason: input.hasUnresolvedFindings ? "Findings remain open" : "Batch can proceed",
    questions: [],
  };
}
```

- [ ] **Step 5: Integrate gate execution into the controller**

```ts
// update src/controller/pipeline-controller.ts
import { buildProposal } from "./build-proposal.js";
import { classifyRequest } from "./classify-request.js";
import { parseMode } from "./parse-mode.js";
import { runInformationGate } from "../gates/information-gate.js";

export function createPipelineController() {
  return {
    async start(input: string) {
      const { mode, normalizedRequest } = parseMode(input);
      const classification = classifyRequest(normalizedRequest);
      const infoGate = runInformationGate({
        request: normalizedRequest,
        classification,
        knownFacts: [],
      });
      const proposal = buildProposal(normalizedRequest, classification);

      return {
        mode,
        type: classification.type,
        complexity: classification.complexity,
        variant: classification.variant,
        proposal,
        gates: [infoGate],
      };
    },
  };
}
```

- [ ] **Step 6: Run gate tests until green**

Run: `npm test -- tests/unit/gates/hardness-policy.test.ts tests/unit/gates/information-gate.test.ts`
Expected: PASS

- [ ] **Step 7: Run adversarial batch review**

Run: `npm test && npm run lint:types`
Run: `git diff --stat HEAD~1`
Challenge:
- Is hardness determined by policy code instead of hard-coded string literals spread around?
- Does the controller expose gate outcomes without silently swallowing them?
- Can blocked gates produce exactly one next question?

- [ ] **Step 8: Commit**

```bash
git add src/gates/gate-types.ts src/gates/hardness-policy.ts src/gates/information-gate.ts src/gates/micro-gate.ts src/controller/pipeline-controller.ts tests/unit/gates/information-gate.test.ts tests/unit/gates/hardness-policy.test.ts
git commit -m "feat: add gate evaluation and hardness policy"
```

### Task 5: Dispatcher Abstraction

**Files:**
- Create: `src/dispatcher/dispatcher-types.ts`
- Create: `src/dispatcher/single-agent-runner.ts`
- Create: `src/dispatcher/run-role.ts`
- Create: `tests/unit/dispatcher/run-role.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing dispatcher tests**

```ts
// tests/unit/dispatcher/run-role.test.ts
import { describe, expect, it } from "vitest";
import { runRole } from "../../../src/dispatcher/run-role";

describe("runRole", () => {
  it("defaults to single-agent emulation mode", async () => {
    const result = await runRole({
      mode: "single-agent",
      role: "information-gate",
      prompt: "Ask one question at a time.",
      input: { request: "fix auth callback" },
    });

    expect(result.mode).toBe("single-agent");
    expect(result.role).toBe("information-gate");
  });
});
```

- [ ] **Step 2: Run dispatcher tests to verify they fail**

Run: `npm test -- tests/unit/dispatcher/run-role.test.ts`
Expected: FAIL because dispatcher modules do not exist yet.

- [ ] **Step 3: Create dispatcher interfaces**

```ts
// src/dispatcher/dispatcher-types.ts
export type DispatchMode = "single-agent" | "multi-agent";

export interface DispatchRequest {
  mode: DispatchMode;
  role: string;
  prompt: string;
  input: Record<string, unknown>;
}

export interface DispatchResult {
  mode: DispatchMode;
  role: string;
  output: Record<string, unknown>;
}
```

```ts
// src/dispatcher/single-agent-runner.ts
import type { DispatchRequest, DispatchResult } from "./dispatcher-types.js";

export async function runSingleAgentRole(request: DispatchRequest): Promise<DispatchResult> {
  return {
    mode: "single-agent",
    role: request.role,
    output: {
      prompt: request.prompt,
      input: request.input,
    },
  };
}
```

- [ ] **Step 4: Create dispatcher entrypoint**

```ts
// src/dispatcher/run-role.ts
import type { DispatchRequest } from "./dispatcher-types.js";
import { runSingleAgentRole } from "./single-agent-runner.js";

export async function runRole(request: DispatchRequest) {
  if (request.mode === "multi-agent") {
    throw new Error("Multi-agent mode is not implemented yet");
  }

  return runSingleAgentRole(request);
}
```

- [ ] **Step 5: Expose dispatcher from runtime bootstrap**

```ts
// update src/index.ts
import { createPipelineController } from "./controller/pipeline-controller.js";
import type { PipelineMode, RuntimeOptions } from "./domain/pipeline-types.js";
import { runRole } from "./dispatcher/run-role.js";
import { createCheckpointStore } from "./state/checkpoint-store.js";
import { createConfidenceScoreStore } from "./state/confidence-score.js";
import { createGateLog } from "./state/gate-log.js";
import { createSessionStore } from "./state/session-store.js";

const SUPPORTED_MODES: PipelineMode[] = [
  "full",
  "diagnostic",
  "continue",
  "review-only",
  "--plan",
  "--grill",
  "--hotfix",
];

export function createPipelineRuntime(options: RuntimeOptions) {
  const stateDir = `${options.cwd}/.codex/pipeline`;

  return {
    controller: createPipelineController(),
    dispatcher: { runRole },
    stateDir,
    supportedModes: SUPPORTED_MODES,
    stores: {
      session: createSessionStore(stateDir),
      checkpoints: createCheckpointStore(stateDir),
      gateLog: createGateLog(stateDir),
      confidence: createConfidenceScoreStore(stateDir),
    },
  };
}
```

- [ ] **Step 6: Run dispatcher tests until green**

Run: `npm test -- tests/unit/dispatcher/run-role.test.ts`
Expected: PASS

- [ ] **Step 7: Run adversarial batch review**

Run: `npm test && npm run lint:types`
Run: `git diff --stat HEAD~1`
Challenge:
- Is dispatcher behavior interface-first rather than LLM-tool-first?
- Did we keep multi-agent mode behind one seam instead of leaking conditionals everywhere?
- Could review independence be emulated with this interface later?

- [ ] **Step 8: Commit**

```bash
git add src/dispatcher/dispatcher-types.ts src/dispatcher/single-agent-runner.ts src/dispatcher/run-role.ts src/index.ts tests/unit/dispatcher/run-role.test.ts
git commit -m "feat: add dispatcher abstraction"
```

### Task 6: Prompt Registry

**Files:**
- Create: `prompts/controller/pipeline-controller.md`
- Create: `prompts/agents/core/information-gate.md`
- Create: `prompts/agents/executor/executor-implementer.md`
- Create: `prompts/agents/quality/adversarial-reviewer.md`
- Create: `src/prompts/prompt-registry.ts`
- Create: `tests/unit/prompts/prompt-registry.test.ts`
- Modify: `src/dispatcher/single-agent-runner.ts`

- [ ] **Step 1: Write failing prompt registry tests**

```ts
// tests/unit/prompts/prompt-registry.test.ts
import { describe, expect, it } from "vitest";
import { createPromptRegistry } from "../../../src/prompts/prompt-registry";

describe("prompt registry", () => {
  it("loads the information gate prompt from disk", async () => {
    const registry = createPromptRegistry(process.cwd());
    const prompt = await registry.load("core/information-gate");
    expect(prompt).toContain("Ask one question at a time");
  });
});
```

- [ ] **Step 2: Run prompt registry tests to verify they fail**

Run: `npm test -- tests/unit/prompts/prompt-registry.test.ts`
Expected: FAIL because prompt assets and registry do not exist yet.

- [ ] **Step 3: Create minimal prompt assets with explicit output contracts**

```md
<!-- prompts/controller/pipeline-controller.md -->
# Pipeline Controller

Read repository context before asking questions.
Classify the request, choose the phase route, and return a structured proposal.

Required output block:
- MODE
- TYPE
- COMPLEXITY
- VARIANT
- PROPOSAL
```

```md
<!-- prompts/agents/core/information-gate.md -->
# Information Gate

Read context before asking.
Ask one question at a time.
Block on missing factual details that would make execution unsafe.

Required output block:
- GATE
- STATUS
- QUESTION
```

```md
<!-- prompts/agents/executor/executor-implementer.md -->
# Executor Implementer

Implement only the current batch.
Prefer minimal change.
Do not silently expand scope.

Required output block:
- CHANGES
- TESTS
- RISKS
```

```md
<!-- prompts/agents/quality/adversarial-reviewer.md -->
# Adversarial Reviewer

Review from fresh context.
Distrust optimistic summaries.
Find correctness, safety, and drift issues with evidence.

Required output block:
- FINDINGS
- SEVERITY
- EVIDENCE
- NEXT_ACTION
```

- [ ] **Step 4: Implement prompt registry and wire it into single-agent dispatch**

```ts
// src/prompts/prompt-registry.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export function createPromptRegistry(root: string) {
  return {
    async load(name: string) {
      const file = join(root, "prompts", `${name}.md`);
      return readFile(file, "utf8");
    },
  };
}
```

```ts
// update src/dispatcher/single-agent-runner.ts
import type { DispatchRequest, DispatchResult } from "./dispatcher-types.js";

export async function runSingleAgentRole(request: DispatchRequest): Promise<DispatchResult> {
  return {
    mode: "single-agent",
    role: request.role,
    output: {
      prompt: request.prompt,
      input: request.input,
      freshContextRequired: request.role.includes("review"),
    },
  };
}
```

- [ ] **Step 5: Run prompt registry tests until green**

Run: `npm test -- tests/unit/prompts/prompt-registry.test.ts`
Expected: PASS

- [ ] **Step 6: Run adversarial batch review**

Run: `npm test && npm run lint:types`
Run: `git diff --stat HEAD~1`
Challenge:
- Does every prompt declare an output contract the runtime can parse later?
- Are prompt file names stable enough to become part of persisted state?
- Did we keep prompts in markdown assets rather than burying them in TypeScript?

- [ ] **Step 7: Commit**

```bash
git add prompts/controller/pipeline-controller.md prompts/agents/core/information-gate.md prompts/agents/executor/executor-implementer.md prompts/agents/quality/adversarial-reviewer.md src/prompts/prompt-registry.ts src/dispatcher/single-agent-runner.ts tests/unit/prompts/prompt-registry.test.ts
git commit -m "feat: add prompt registry and core prompt assets"
```

### Task 7: Continue Mode

**Files:**
- Create: `src/continue/load-session.ts`
- Create: `src/continue/resume-pipeline.ts`
- Create: `tests/unit/continue/resume-pipeline.test.ts`
- Modify: `src/controller/pipeline-controller.ts`
- Modify: `src/state/session-store.ts`

- [ ] **Step 1: Write failing continue-mode tests**

```ts
// tests/unit/continue/resume-pipeline.test.ts
import { describe, expect, it } from "vitest";
import { resumePipeline } from "../../../src/continue/resume-pipeline";

describe("resume pipeline", () => {
  it("resumes from the last safe checkpoint", async () => {
    const result = await resumePipeline({
      session: {
        sessionId: "session-1",
        currentPhase: "phase-2",
        mode: "continue",
        variant: "implement-heavy",
        confidenceScore: 0.82,
      },
      checkpoints: [{ name: "phase-2-batch-1", status: "completed" }],
    });

    expect(result.resumeFrom).toBe("phase-2-batch-1");
    expect(result.nextPhase).toBe("phase-2");
  });
});
```

- [ ] **Step 2: Run continue-mode tests to verify they fail**

Run: `npm test -- tests/unit/continue/resume-pipeline.test.ts`
Expected: FAIL because continue modules do not exist yet.

- [ ] **Step 3: Implement session loading and resume decision logic**

```ts
// src/continue/load-session.ts
export async function loadSession(runtime: {
  stores: {
    session: { load: () => Promise<unknown> };
  };
}) {
  return runtime.stores.session.load();
}
```

```ts
// src/continue/resume-pipeline.ts
export async function resumePipeline(input: {
  session: {
    currentPhase: string;
  };
  checkpoints: Array<{ name: string; status: string }>;
}) {
  const lastCompleted = [...input.checkpoints].reverse().find((entry) => entry.status === "completed");

  if (!lastCompleted) {
    throw new Error("No completed checkpoint available to resume");
  }

  return {
    resumeFrom: lastCompleted.name,
    nextPhase: input.session.currentPhase,
  };
}
```

- [ ] **Step 4: Teach the controller to branch into continue mode**

```ts
// update src/controller/pipeline-controller.ts
import { runInformationGate } from "../gates/information-gate.js";
import { resumePipeline } from "../continue/resume-pipeline.js";
import { buildProposal } from "./build-proposal.js";
import { classifyRequest } from "./classify-request.js";
import { parseMode } from "./parse-mode.js";

export function createPipelineController(runtime?: {
  stores?: {
    session: { load: () => Promise<unknown> };
  };
}) {
  return {
    async start(input: string) {
      const { mode, normalizedRequest } = parseMode(input);

      if (mode === "continue") {
        const session = (await runtime?.stores?.session.load?.()) as {
          currentPhase: string;
        };
        const checkpoints = (await runtime?.stores?.checkpoints.list?.()) as Array<{
          name: string;
          status: string;
        }>;
        return resumePipeline({
          session,
          checkpoints,
        });
      }

      const classification = classifyRequest(normalizedRequest);
      const infoGate = runInformationGate({
        request: normalizedRequest,
        classification,
        knownFacts: [],
      });
      const proposal = buildProposal(normalizedRequest, classification);

      return {
        mode,
        type: classification.type,
        complexity: classification.complexity,
        variant: classification.variant,
        proposal,
        gates: [infoGate],
      };
    },
  };
}
```

- [ ] **Step 5: Update runtime bootstrap to pass stores into the controller**

```ts
// update src/index.ts
import { createPipelineController } from "./controller/pipeline-controller.js";
import type { PipelineMode, RuntimeOptions } from "./domain/pipeline-types.js";
import { runRole } from "./dispatcher/run-role.js";
import { createCheckpointStore } from "./state/checkpoint-store.js";
import { createConfidenceScoreStore } from "./state/confidence-score.js";
import { createGateLog } from "./state/gate-log.js";
import { createSessionStore } from "./state/session-store.js";

const SUPPORTED_MODES: PipelineMode[] = [
  "full",
  "diagnostic",
  "continue",
  "review-only",
  "--plan",
  "--grill",
  "--hotfix",
];

export function createPipelineRuntime(options: RuntimeOptions) {
  const stateDir = `${options.cwd}/.codex/pipeline`;
  const stores = {
    session: createSessionStore(stateDir),
    checkpoints: createCheckpointStore(stateDir),
    gateLog: createGateLog(stateDir),
    confidence: createConfidenceScoreStore(stateDir),
  };

  return {
    controller: createPipelineController({ stores }),
    dispatcher: { runRole },
    stateDir,
    supportedModes: SUPPORTED_MODES,
    stores,
  };
}
```

- [ ] **Step 6: Run continue-mode tests until green**

Run: `npm test -- tests/unit/continue/resume-pipeline.test.ts`
Expected: PASS

- [ ] **Step 7: Run adversarial batch review**

Run: `npm test && npm run lint:types`
Run: `git diff --stat HEAD~1`
Challenge:
- Can `continue` fail loudly when state is missing or invalid?
- Is resume anchored to a completed checkpoint instead of current optimism?
- Is continue behavior isolated from normal start behavior?

- [ ] **Step 8: Commit**

```bash
git add src/continue/load-session.ts src/continue/resume-pipeline.ts src/controller/pipeline-controller.ts src/index.ts tests/unit/continue/resume-pipeline.test.ts
git commit -m "feat: add continue mode and resume routing"
```

### Task 8: Execution Loop, Adversarial Review, and Final Validation

**Files:**
- Create: `src/execution/build-batches.ts`
- Create: `src/execution/run-batch.ts`
- Create: `src/review/adversarial-review.ts`
- Create: `src/validation/final-validator.ts`
- Create: `src/closeout/render-closeout.ts`
- Create: `tests/integration/execution/pipeline-runner.test.ts`
- Modify: `src/controller/pipeline-controller.ts`
- Modify: `src/dispatcher/run-role.ts`

- [ ] **Step 1: Write failing integration test for phased execution**

```ts
// tests/integration/execution/pipeline-runner.test.ts
import { describe, expect, it } from "vitest";
import { createPipelineRuntime } from "../../../src/index";

describe("pipeline execution", () => {
  it("builds batches, runs review, and returns a closeout summary", async () => {
    const runtime = createPipelineRuntime({
      cwd: "/repo",
      codexHome: "/codex-home",
    });

    const result = await runtime.controller.start("implement audit-friendly continue mode");

    expect(result.proposal.awaitingUserConfirmation).toBe(true);
  });
});
```

- [ ] **Step 2: Run integration test to verify the future seam is visible**

Run: `npm test -- tests/integration/execution/pipeline-runner.test.ts`
Expected: PASS or pending for proposal stage only
Then add a second failing test:

```ts
// add to tests/integration/execution/pipeline-runner.test.ts
it("runs a batch through adversarial review and final validation", async () => {
  const { buildBatches } = await import("../../../src/execution/build-batches");
  const { runAdversarialReview } = await import("../../../src/review/adversarial-review");
  const { runFinalValidator } = await import("../../../src/validation/final-validator");

  const batches = buildBatches({
    files: ["src/controller/pipeline-controller.ts", "src/state/session-store.ts"],
  });
  const review = await runAdversarialReview({
    batch: batches[0],
    findings: [],
  });
  const final = runFinalValidator({
    reviews: [review],
    confidenceScore: 0.91,
  });

  expect(final.status).toBe("go");
});
```

Run: `npm test -- tests/integration/execution/pipeline-runner.test.ts`
Expected: FAIL because execution and validation modules do not exist yet.

- [ ] **Step 3: Implement batch planning and adversarial review**

```ts
// src/execution/build-batches.ts
export function buildBatches(input: { files: string[] }) {
  const chunkSize = 2;
  const batches: Array<{ name: string; files: string[] }> = [];

  for (let index = 0; index < input.files.length; index += chunkSize) {
    batches.push({
      name: `batch-${batches.length + 1}`,
      files: input.files.slice(index, index + chunkSize),
    });
  }

  return batches;
}
```

```ts
// src/review/adversarial-review.ts
export async function runAdversarialReview(input: {
  batch: { name: string; files: string[] };
  findings: Array<{ severity: string }>;
}) {
  const blocking = input.findings.some((finding) => finding.severity === "critical" || finding.severity === "important");

  return {
    batch: input.batch.name,
    status: blocking ? "blocked" : "approved",
    findings: input.findings,
  };
}
```

- [ ] **Step 4: Implement final validator and closeout renderer**

```ts
// src/validation/final-validator.ts
export function runFinalValidator(input: {
  reviews: Array<{ status: string }>;
  confidenceScore: number;
}) {
  const hasBlockedReview = input.reviews.some((review) => review.status !== "approved");
  const hasEnoughConfidence = input.confidenceScore >= 0.7;

  return {
    status: !hasBlockedReview && hasEnoughConfidence ? "go" : "no-go",
  };
}
```

```ts
// src/closeout/render-closeout.ts
export function renderCloseout(input: {
  status: "go" | "no-go";
  batches: Array<{ name: string }>;
}) {
  return [
    `Final status: ${input.status}`,
    `Batches executed: ${input.batches.map((batch) => batch.name).join(", ")}`,
  ].join("\n");
}
```

- [ ] **Step 5: Implement batch runner seam and route through dispatcher**

```ts
// src/execution/run-batch.ts
import { runRole } from "../dispatcher/run-role.js";
import { runAdversarialReview } from "../review/adversarial-review.js";

export async function runBatch(batch: { name: string; files: string[] }) {
  const execution = await runRole({
    mode: "single-agent",
    role: "executor-implementer",
    prompt: "Implement only the current batch.",
    input: { batch },
  });

  const review = await runAdversarialReview({
    batch,
    findings: [],
  });

  return {
    execution,
    review,
  };
}
```

- [ ] **Step 6: Run integration tests until green**

Run: `npm test -- tests/integration/execution/pipeline-runner.test.ts`
Expected: PASS

- [ ] **Step 7: Run adversarial batch review**

Run: `npm test && npm run lint:types`
Run: `git diff --stat HEAD~1`
Challenge:
- Is adversarial review required for every batch, not just final closeout?
- Can final validation reject work even after execution succeeded?
- Is the execution loop capable of staying single-agent now and multi-agent later?

- [ ] **Step 8: Commit**

```bash
git add src/execution/build-batches.ts src/execution/run-batch.ts src/review/adversarial-review.ts src/validation/final-validator.ts src/closeout/render-closeout.ts tests/integration/execution/pipeline-runner.test.ts
git commit -m "feat: add execution loop, adversarial review, and final validation"
```

### Task 9: Productization, Skills, Hooks, and Scenario Coverage

**Files:**
- Modify: `skills/pipeline/SKILL.md`
- Modify: `hooks/hooks.json`
- Create: `tests/integration/scenarios/diagnostic-mode.test.ts`
- Create: `tests/integration/scenarios/continue-mode.test.ts`
- Create: `tests/integration/scenarios/review-only.test.ts`
- Modify: `README.md`
- Modify: `.codex-plugin/plugin.json`
- Modify: `src/controller/pipeline-controller.ts`

- [ ] **Step 1: Write failing scenario tests**

```ts
// tests/integration/scenarios/diagnostic-mode.test.ts
import { describe, expect, it } from "vitest";
import { createPipelineRuntime } from "../../../src/index";

describe("diagnostic mode", () => {
  it("stops after proposal and marks the run as non-executing", async () => {
    const runtime = createPipelineRuntime({
      cwd: "/repo",
      codexHome: "/codex-home",
    });

    const result = await runtime.controller.start("/pipeline diagnostic audit auth flow");

    expect(result.mode).toBe("diagnostic");
    expect(result.stoppedAfterProposal).toBe(true);
  });
});
```

```ts
// tests/integration/scenarios/continue-mode.test.ts
import { describe, expect, it } from "vitest";
import { resumePipeline } from "../../../src/continue/resume-pipeline";

describe("continue mode", () => {
  it("throws a clear error when persisted state is missing", async () => {
    await expect(
      resumePipeline({
        session: {
          currentPhase: "phase-2",
        },
        checkpoints: [],
      }),
    ).rejects.toThrow("No completed checkpoint available to resume");
  });
});
```

```ts
// tests/integration/scenarios/review-only.test.ts
import { describe, expect, it } from "vitest";
import { createPipelineRuntime } from "../../../src/index";

describe("review-only mode", () => {
  it("runs review planning without entering implementation", async () => {
    const runtime = createPipelineRuntime({
      cwd: "/repo",
      codexHome: "/codex-home",
    });

    const result = await runtime.controller.start("/pipeline review-only inspect auth boundaries");

    expect(result.mode).toBe("review-only");
    expect(result.implementationSkipped).toBe(true);
  });
});
```

- [ ] **Step 2: Create Codex-facing skill and hook metadata**

```md
<!-- skills/pipeline/SKILL.md -->
---
name: pipeline
description: Run the Codex pipeline with explicit phases, gates, state, and adversarial review.
---

# Pipeline

Use this skill when a task needs structured execution across multiple phases.

Core runtime:
- classify
- show proposal
- persist state
- execute in batches
- run adversarial review each batch
- support continue mode
```

```json
// hooks/hooks.json
{
  "hooks": [
    {
      "name": "pipeline-bootstrap",
      "event": "beforeRun",
      "action": "initialize-state"
    },
    {
      "name": "pipeline-persist-phase",
      "event": "afterRun",
      "action": "persist-checkpoint"
    }
]
}
```

```ts
// update src/controller/pipeline-controller.ts
import { runInformationGate } from "../gates/information-gate.js";
import { resumePipeline } from "../continue/resume-pipeline.js";
import { buildProposal } from "./build-proposal.js";
import { classifyRequest } from "./classify-request.js";
import { parseMode } from "./parse-mode.js";

export function createPipelineController(runtime?: {
  stores?: {
    session: { load: () => Promise<unknown> };
    checkpoints: { list: () => Promise<Array<{ name: string; status: string }>> };
  };
}) {
  return {
    async start(input: string) {
      const { mode, normalizedRequest } = parseMode(input);

      if (mode === "continue") {
        const session = (await runtime?.stores?.session.load?.()) as {
          currentPhase: string;
        };
        const checkpoints = await runtime?.stores?.checkpoints.list?.();
        return resumePipeline({
          session,
          checkpoints: checkpoints ?? [],
        });
      }

      const classification = classifyRequest(normalizedRequest);
      const infoGate = runInformationGate({
        request: normalizedRequest,
        classification,
        knownFacts: [],
      });
      const proposal = buildProposal(normalizedRequest, classification);

      if (mode === "diagnostic") {
        return {
          mode,
          type: classification.type,
          complexity: classification.complexity,
          variant: classification.variant,
          proposal,
          gates: [infoGate],
          stoppedAfterProposal: true,
        };
      }

      if (mode === "review-only") {
        return {
          mode,
          type: classification.type,
          complexity: classification.complexity,
          variant: classification.variant,
          proposal,
          gates: [infoGate],
          implementationSkipped: true,
        };
      }

      return {
        mode,
        type: classification.type,
        complexity: classification.complexity,
        variant: classification.variant,
        proposal,
        gates: [infoGate],
      };
    },
  };
}
```

- [ ] **Step 3: Update root documentation to match shipped capabilities**

```md
<!-- append to README.md -->
## Implementation Status

- controller scaffold
- persistent state
- gates and hardness
- dispatcher abstraction
- prompt registry
- continue mode
- batch execution with adversarial review
- final validation

## Next Commands

- `npm install`
- `npm test`
- inspect `docs/pipeline-orchestrator-codex/`
- use `docs/superpowers/plans/2026-03-31-pipeline-orchestrator-codex-implementation.md` as the build authority
```

- [ ] **Step 4: Run the full regression suite**

Run: `npm test`
Run: `npm run lint:types`
Expected: PASS

- [ ] **Step 5: Run final adversarial batch review**

Run: `git diff --stat origin/main...HEAD`
Run: `npm test`
Challenge:
- Does the shipped plugin metadata point only to folders that now exist?
- Do docs promise only what the current code supports?
- Is there at least one test for `diagnostic`, `continue`, and `review-only`?
- Could a fresh engineer start implementation from this repository without hidden context?

- [ ] **Step 6: Commit**

```bash
git add skills/pipeline/SKILL.md hooks/hooks.json tests/integration/scenarios/diagnostic-mode.test.ts tests/integration/scenarios/continue-mode.test.ts tests/integration/scenarios/review-only.test.ts README.md .codex-plugin/plugin.json
git commit -m "feat: productize codex pipeline scaffolding"
```

## Final Acceptance Criteria

- `npm test` passes
- `npm run lint:types` passes
- `.codex-plugin/plugin.json`, `skills/pipeline/SKILL.md`, and `hooks/hooks.json` exist and agree on runtime shape
- `continue` restores from persisted session state and safe checkpoints
- every batch has an explicit adversarial review step before commit
- final validation can return `no-go`
- prompts live in `prompts/` and are loaded through the registry
- controller remains the single source of orchestration truth

## Risks to Re-check During Execution

- Codex plugin packaging details may evolve; verify manifest compatibility before widening the interface.
- Multi-agent support should remain optional until explicit user permission and runtime support are available.
- Keyword-only classification is acceptable in the first batch but should be replaced with richer routing once tests lock behavior.
- Hook semantics in Codex may need controller-side emulation even if metadata files exist.
