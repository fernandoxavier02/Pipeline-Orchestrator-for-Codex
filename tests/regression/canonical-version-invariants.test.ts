import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const manifestPath = join(repoRoot, "tests", "regression", "canonical-version-manifest.json");

type Release = {
  version: string;
  status: "covered" | "partial" | "deferred";
  evidence?: string[];
};

type Manifest = {
  releases: Release[];
};

type Invariant = {
  version: string;
  evidencePath: string;
  patterns: RegExp[];
};

const invariants: Invariant[] = [
  {
    version: "v6.1.0",
    evidencePath: "references/gates.md",
    patterns: [/CAPABILITY_GATE/, /SSOT_CONFLICT/, /36` gates/],
  },
  {
    version: "v6.3.0",
    evidencePath: "references/implementation-discipline.md",
    patterns: [/CHANGE_CONTRACT/, /SCOPE LOCK CHECK/, /test_integrity|Test Integrity Rules/i],
  },
  {
    version: "v7.1.0",
    evidencePath: "src/state/gate-log.ts",
    patterns: [/SINGLE authorized writer/, /CANONICAL_GATE_DECISION_MAP/, /sanitizeDetail/],
  },
  {
    version: "v7.3.0",
    evidencePath: "evals/README.md",
    patterns: [/scope_review/, /manual evidence/i, /run_eval\.py/],
  },
  {
    version: "v7.5.0",
    evidencePath: "src/run/run-directory.ts",
    patterns: [/await mkdir\(runDir\)/, /001-999/, /manifest\.yaml/],
  },
  {
    version: "v7.6.0",
    evidencePath: "references/paperclip/spec/lib/measure-fidelity.cjs",
    patterns: [/runMeasureFidelity/, /assertSafeId/, /buildReport/],
  },
  {
    version: "v7.9.0",
    evidencePath: "references/paperclip/PAPERCLIP-FLOW-MIRROR.md",
    patterns: [/14 fluxos/, /blockedByIssueIds/, /tree-template\.cjs/],
  },
  {
    version: "v7.9.3",
    evidencePath: "hooks/session-cleanup-hook.cjs",
    patterns: [/FIDELITY_REPORTS_DIR/, /flag: 'wx'/, /stop-hook-fidelity/],
  },
  {
    version: "v7.10.0",
    evidencePath: "src/controller/plan-mode.ts",
    patterns: [/PLAN_MODE_REQUEST/, /expected_deliverables/, /PDD: visible update_plan protocol/],
  },
  {
    version: "v7.10.1",
    evidencePath: "tests/integration/claude-v710-parity.test.ts",
    patterns: [/parallel_eligible/, /analysis_incomplete:/, /WARN.*parallel_eligible absent/],
  },
  {
    version: "v7.11.0",
    evidencePath: "references/visible-plan-contract.md",
    patterns: [/VISIBLE_PLAN/, /update_plan/, /terminal_block: NEXT_STEP/],
  },
  {
    version: "v7.12.0",
    evidencePath: "src/controller/classify-request.ts",
    patterns: [/User Story/, /UX Simulation/, /spec-audit-only/],
  },
];

function loadManifest(): Manifest {
  return JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
}

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

describe("canonical version executable invariants", () => {
  it("keeps one executable invariant for every covered canonical release", () => {
    const manifest = loadManifest();
    const invariantByVersion = new Map(invariants.map((invariant) => [invariant.version, invariant]));

    for (const release of manifest.releases) {
      if (release.status === "deferred") {
        expect(release.evidence, release.version).toBeUndefined();
        continue;
      }

      expect(release.status, release.version).toBe("covered");
      const invariant = invariantByVersion.get(release.version);
      expect(invariant, `${release.version} must have an executable invariant`).toBeDefined();
      expect(release.evidence, release.version).toContain(invariant?.evidencePath);
    }
  });

  it("verifies each versioned invariant against current repo evidence", () => {
    for (const invariant of invariants) {
      const absolutePath = join(repoRoot, invariant.evidencePath);
      expect(existsSync(absolutePath), `${invariant.version}: ${invariant.evidencePath}`).toBe(true);

      const body = read(invariant.evidencePath);
      for (const pattern of invariant.patterns) {
        expect(body, `${invariant.version}: ${invariant.evidencePath} should match ${pattern}`).toMatch(pattern);
      }
    }
  });
});
