import { resolve, normalize } from "node:path";
import { realpathSync } from "node:fs";

const ALLOWED_STATE_ROOTS = [
  ".codex",
  "pipeline-runs",
  ".pipeline",
];

/**
 * Validate that a state store root does not contain path traversal.
 * Rejects paths with ".." components that could escape intended boundaries.
 * Absolute paths are permitted (e.g., test tmpdirs) as long as they don't traverse.
 */
export function resolveValidatedRoot(root: string): string {
  const normalizedInput = normalize(root);

  // Reject explicit path traversal
  if (normalizedInput.includes("..")) {
    throw new Error(
      `SECURITY: state store root "${root}" contains path traversal (".."). Denied.`,
    );
  }

  let resolved = resolve(process.cwd(), root);

  // Follow symlinks to prevent symlink-escape attacks (.codex -> /tmp/attacker)
  try {
    resolved = realpathSync(resolved);
  } catch {
    // If realpath fails (target doesn't exist), continue with resolved path.
    // The directory-creation or file-write will fail later if the path is truly invalid.
  }

  const cwd = resolve(process.cwd());

  // If the path resolves inside the workspace, also enforce known-safe directory
  if (resolved.startsWith(cwd)) {
    const relative = resolved.slice(cwd.length + 1);
    const firstPart = relative.split(/[/\\]/)[0];
    if (!ALLOWED_STATE_ROOTS.includes(firstPart)) {
      throw new Error(
        `SECURITY: state store root "${root}" does not resolve into a known safe directory (${ALLOWED_STATE_ROOTS.join(", ")}).`,
      );
    }
  }

  return resolved;
}
