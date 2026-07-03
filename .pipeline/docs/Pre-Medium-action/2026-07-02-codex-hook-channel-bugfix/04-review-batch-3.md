# 04 — Review Batch 3 (REDO, RE-REVIEW after fix attempt 3, FINAL of cycle)

- **Batch:** 3 of 3
- **Complexity:** COMPLEXA
- **Date:** 2026-07-03
- **Reviewers (parallel, clean context):** adversarial-batch + architecture-reviewer + diff-discipline-reviewer
- **Files:** hooks/edit-guard-hook.cjs (M), hooks/path-safety.cjs (A), scripts/pipeline-reset.cjs (A), tests/unit/hooks/edit-guard-hook.test.ts (M), tests/unit/security/pipeline-reset.test.ts (A)
- **Threat model:** defense-in-depth vs confused/steered model, NOT a sandbox vs determined attacker. Static shell-string analysis acknowledged non-airtight. Severity calibrated accordingly.

## Status: PASS_WITH_WARNINGS — action_required: NONE — recommendation: CLOSE

### ADV-1/2/3 verification (adversarial-batch)
- **ADV-1 ANSI-C `$'...'` — CLOSED.** `scanSegment` mode 3 (edit-guard-hook.cjs:146,161-172,194); redirection view catches `>` (:226-228,:277). Test :1039.
- **ADV-2 wrapper verb resolution — CLOSED.** `resolveCommandWord` peels transparent wrappers + flags (:246-258,136-138), result appended to verb scan (:270-271). `sudo "c"p`, `env \c\p` traced. Test :1056.
- **ADV-3 attached code-flags — CLOSED.** SHORT/LONG_CODE_FLAGS split fused tail into payload (:129-130,213-216); `bash -c"cp.."`, `node --eval="fs.rmSync(..)"`, `python -c"open(..'w')"` traced. Test :1069.

### Regressions — NONE (all required commands still ALLOWED)
`git commit -m "cp helper"` (:1030/:1063), `echo "x => y"` / `echo "mv a b"` (:781/:803), `npm install` + `cat install.md` (GNU_INSTALL_RE `^install`-anchored, :809/:1005), read-only `.codex/pipeline` reads (short-circuit :797). No false-positive found.

### pipeline-reset.cjs / path-safety.cjs — CORRECT
F6 symlink-escape refused fail-closed (reset:64-68,128-131; test :108). No new TOCTOU (lstat→unlink on fixed name, symlink skipped :92-95). path-safety realpathOfExistingAncestor sound; both consumers import it, no duplicated logic (arch-review confirmed via grep). Builtins-only honored.

### Tests attack for real
Real PoC command strings assert deny===true, paired regression cases assert deny===false. Only conditional returns are OS symlink-privilege skips (standard Windows guard), not assertion bypasses. 71 passed / 0 failed. lint clean.

## Combined findings (all Minor / Accepted-Ceiling — none in fix scope)
| id | source | severity | file:line | note |
|----|--------|----------|-----------|------|
| F-1 | adversarial | Minor (pre-existing) | edit-guard-hook.cjs:57,205-207 | `-c`/`-e` payload scan over-captures (`gcc -c mv.c`); not introduced by this batch. Optional: gate payload scan to known interpreters. |
| F-2 | adversarial | Accepted-Ceiling | edit-guard-hook.cjs:82 | `sudo install` not caught (commandWord not at pos 0). Deliberate-attacker vector, documented. |
| F-3 | adversarial | Accepted-Ceiling | edit-guard-hook.cjs:380-392 | `$(...)`-obfuscated protected-path evades mention check. Static analysis non-airtight. |
| ARCH-R1 | architecture | Minor | edit-guard-hook.cjs:395 | Path EXTRACTION still uses old regex extractBashTargetPaths (allow-listing only); scanner backstops write-detection so not exploitable. Add comment marking it allow-list-only. |
| ARCH-R2 | architecture | Minor | pipeline-reset.cjs:32,198-204 | Re-exports realpathOfExistingAncestor (unconsumed). Drop from exports. |
| ARCH-R3 | architecture | Minor | tests/unit/security/pipeline-reset.test.ts | No test for per-file symlink-skip in removeTarget (only dir-level F6). Add one case. |
| ARCH-R4 | architecture | Minor | tests (symlink cases) | Symlink-defense tests self-skip on non-elevated Windows → may never run locally. Gate on POSIX/elevated CI so the defense stays proven. **Best follow-up candidate.** |

diff-discipline soft note = ARCH-R2 (same unconsumed export); logged as DIFF_DISCIPLINE_NEEDS_REDUCTION, SOFT, NOT in fix scope.

## Decision
No Critical, no Important, no REJECTED, no regressions. ADV-1/2/3 closed and test-proven. Remaining vectors are pre-existing over-capture or exotic deliberate-attacker obfuscation at the acknowledged static-analysis ceiling. **CLOSE the batch.** Suggested (non-blocking) backlog: ARCH-R4 (CI symlink coverage), then ARCH-R1/R2/R3.
