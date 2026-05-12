#!/usr/bin/env node
/**
 * close-exec-window.cjs
 * Deterministically close an exec-window and clean up session state.
 * Usage: node close-exec-window.cjs --session-id=<id>
 */

const fs = require("fs");
const path = require("path");

const SESSIONS_DIR = path.join(".pipeline", "sessions");
const AUDIT_LOG = path.join(SESSIONS_DIR, "audit.log");

function main() {
  const args = process.argv.slice(2);
  let session_id = null;

  for (const arg of args) {
    if (arg.startsWith("--session-id=")) {
      session_id = arg.slice("--session-id=".length);
    }
  }

  if (!session_id) {
    console.error(JSON.stringify({ status: "error", reason: "session_id is required" }));
    process.exit(1);
  }

  const sessionFile = path.join(SESSIONS_DIR, `${session_id}.exec-window`);

  if (!fs.existsSync(sessionFile)) {
    console.log(JSON.stringify({ status: "success", note: "exec-window already closed or never existed" }));
    process.exit(0);
  }

  // Read before delete for audit
  let payload = null;
  try {
    payload = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
  } catch (e) {
    // ignore parse error, still delete
  }

  // Atomic delete
  fs.unlinkSync(sessionFile);

  // Append audit line
  const auditLine = JSON.stringify({
    event: "exec-window-closed",
    session_id,
    timestamp: Date.now(),
    purpose: payload ? payload.purpose : null,
  }) + "\n";

  fs.appendFileSync(AUDIT_LOG, auditLine, { encoding: "utf8" });

  console.log(JSON.stringify({ status: "success", session_id }));
}

main();
