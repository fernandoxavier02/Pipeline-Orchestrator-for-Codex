#!/usr/bin/env node
'use strict';

/**
 * path-safety.cjs — shared symlink-defense path canonicalizer.
 *
 * Extracted from edit-guard-hook.cjs (realpathWithExistingAncestor) and
 * scripts/pipeline-reset.cjs (realpathOfExistingAncestor), which each carried
 * the same ~18-line loop on the symlink-escape defense path. Duplicating a
 * security-defense loop invites divergence, so it lives once here.
 *
 * CJS, Node builtins only.
 */

const fs = require('fs');
const path = require('path');

// Canonicalize a (possibly non-existent) path by resolving the realpath of its
// nearest existing ancestor and re-appending the pending (not-yet-created)
// parts — so a symlinked ancestor (e.g. `.codex -> /external`) is followed
// before any containment check. Returns the resolved absolute path, or null if
// nothing along the chain can be resolved. Callers keep their own one-line
// fallback: edit-guard falls back to the lexical target; pipeline-reset refuses.
function realpathOfExistingAncestor(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    // Does not exist yet — resolve nearest existing ancestor + pending parts.
  }
  const pending = [];
  let cursor = target;
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) return null;
    pending.unshift(path.basename(cursor));
    cursor = parent;
  }
  try {
    return path.join(fs.realpathSync(cursor), ...pending);
  } catch {
    return null;
  }
}

module.exports = { realpathOfExistingAncestor };
