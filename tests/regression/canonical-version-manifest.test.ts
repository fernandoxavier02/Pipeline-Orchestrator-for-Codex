import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const manifestPath = join(repoRoot, "tests", "regression", "canonical-version-manifest.json");

type ReleaseStatus = "covered" | "partial" | "deferred";

type Manifest = {
  schemaVersion: number;
  sourceAudit: string;
  canonicalRange: string;
  codexBaseline: string;
  claimBoundary: string;
  statusVocabulary: ReleaseStatus[];
  releases: Array<{
    version: string;
    theme: string;
    status: ReleaseStatus;
    evidence?: string[];
    deferredReason?: string;
  }>;
};

function loadManifest(): Manifest {
  return JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
}

describe("canonical version regression manifest", () => {
  it("indexes the v6.0.0 to v7.12.0 regression range without overstating coverage", () => {
    const manifest = loadManifest();

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.canonicalRange).toBe("v6.0.0-v7.12.0");
    expect(manifest.codexBaseline).toBe("v0.5.0");
    expect(manifest.claimBoundary).toContain("does not claim the full canonical regression suite");
    expect(manifest.statusVocabulary).toEqual(["covered", "partial", "deferred"]);

    const versions = new Set(manifest.releases.map((release) => release.version));
    for (const requiredVersion of ["v6.0.0", "v6.1.0", "v6.3.0", "v7.9.0", "v7.10.0", "v7.12.0"]) {
      expect(versions.has(requiredVersion), `${requiredVersion} must be indexed`).toBe(true);
    }
  });

  it("requires concrete repo evidence for non-deferred release entries", () => {
    const manifest = loadManifest();

    for (const release of manifest.releases) {
      expect(release.version, release.version).toMatch(/^v\d+\.\d+\.\d+$/);
      expect(release.theme.trim(), release.version).not.toBe("");

      if (release.status === "deferred") {
        expect(release.deferredReason?.trim(), release.version).toBeTruthy();
        expect(release.evidence, release.version).toBeUndefined();
        continue;
      }

      expect(release.evidence?.length, release.version).toBeGreaterThanOrEqual(2);
      for (const evidencePath of release.evidence ?? []) {
        expect(existsSync(join(repoRoot, evidencePath)), `${release.version}: ${evidencePath}`).toBe(true);
      }
    }
  });
});
