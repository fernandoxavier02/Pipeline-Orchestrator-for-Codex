/**
 * Spec: pipeline-trust-restoration / R13 — Exec Window Resists Symlink Attack.
 * Post-review (C4): cross-platform unit coverage of rejectSymlink. The
 * integration test in tests/integration/ skips on Windows because creating
 * symbolic links requires developer-mode / admin. This unit test injects a
 * fake `lstatFn` so the symlink-refused branch is exercised on every
 * platform without depending on ESM module mocking.
 *
 * Windows limitation (documented, not yet fixed by code):
 *   NTFS junction points (directory reparse points) bypass `isSymbolicLink()`
 *   and are not detected by rejectSymlink. SEC-006 in the trust-restoration
 *   adversarial review flagged this gap; tracked for a follow-up hardening PR.
 */

import { describe, expect, it } from "vitest";

const openModule = require("../../scripts/exec-window/open.cjs") as {
  rejectSymlink: (
    targetPath: string,
    lstatFn?: (path: string) => { isSymbolicLink: () => boolean },
  ) => void;
};

describe("R13 / C4: rejectSymlink cross-platform unit coverage", () => {
  it("throws SYMLINK_REFUSED when lstat reports a symlink", () => {
    expect(() =>
      openModule.rejectSymlink("/fake/target", () => ({ isSymbolicLink: () => true })),
    ).toThrow(/SymlinkRefusedError/);
  });

  it("structured error carries err.code = 'SYMLINK_REFUSED'", () => {
    let caught: (Error & { code?: string }) | undefined;
    try {
      openModule.rejectSymlink("/fake/target", () => ({ isSymbolicLink: () => true }));
    } catch (err) {
      caught = err as Error & { code?: string };
    }
    expect(caught).toBeDefined();
    expect(caught?.code).toBe("SYMLINK_REFUSED");
  });

  it("returns silently when lstat reports a regular file", () => {
    expect(() =>
      openModule.rejectSymlink("/fake/target", () => ({ isSymbolicLink: () => false })),
    ).not.toThrow();
  });

  it("returns silently when lstat throws ENOENT (target does not exist)", () => {
    expect(() =>
      openModule.rejectSymlink("/fake/target", () => {
        const err = new Error("ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }),
    ).not.toThrow();
  });
});
