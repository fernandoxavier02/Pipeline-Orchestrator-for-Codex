#!/usr/bin/env node
/**
 * open-exec-window.cjs
 * Deterministically open an exec-window for the pipeline-orchestrator.
 * Usage: node open-exec-window.cjs --session-id=<id> --purpose=<text> [--ttl-minutes=5]
 */

const fs = require("fs");
const path = require("path");

const SESSIONS_DIR = path.join(".pipeline", "sessions");
const AUDIT_LOG = path.join(SESSIONS_DIR, "audit.log");

function main() {
  const args = process.argv.slice(2);
  const opts = {};

  for (const arg of args) {
    if (arg.startsWith("--session-id=")) {
      opts.session_id = arg.slice("--session-id=".length);
    } else if (arg.startsWith("--purpose=")) {
      opts.purpose = arg.slice("--purpose=".length);
    } else if (arg.startsWith("--ttl-minutes=")) {
      opts.ttl_minutes = parseInt(arg.slice("--ttl-minutes=".length), 10);
    }
  }

  // Validate required inputs
  if (!opts.session_id || typeof opts.session_id !== "string" || opts.session_id.length < 3) {
    console.error(JSON.stringify({ status: "error", reason: "session_id is required and must be >= 3 chars" }));
    process.exit(1);
  }
  if (!opts.purpose || opts.purpose.length < 3) {
    console.error(JSON.stringify({ status: "error", reason: "purpose is required and must be >= 3 chars" }));
    process.exit(1);
  }

  const ttl = Number.isFinite(opts.ttl_minutes) && opts.ttl_minutes > 0 ? opts.ttl_minutes : 5;
  if (ttl > 60) {
    console.error(JSON.stringify({ status: "error", reason: "ttl_minutes cannot exceed 60" }));
    process.exit(1);
  }

  // Ensure sessions dir exists
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }

  const sessionFile = path.join(SESSIONS_DIR, `${opts.session_id}.exec-window`);

  // Check for existing lock (mutual exclusion)
  if (fs.existsSync(sessionFile)) {
    const existing = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
    const now = Date.now();
    if (existing.expires_at && existing.expires_at > now) {
      console.error(JSON.stringify({ status: "error", reason: "session_id already has an active exec-window" }));
      process.exit(1);
    }
  }

  const now = Date.now();
  const payload = {
    session_id: opts.session_id,
    purpose: opts.purpose,
    ttl_minutes: ttl,
    opened_at: now,
    expires_at: now + ttl * 60 * 1000,
    spawning_agent: "pipeline-controller",
    version: "1.0.0",
  };

  // Atomic write: write to temp, then rename
  const tempFile = `${sessionFile}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(payload, null, 2) + "\n", { encoding: "utf8" });
  fs.renameSync(tempFile, sessionFile);

  // Append audit line
  const auditLine = JSON.stringify({
    event: "exec-window-opened",
    session_id: opts.session_id,
    timestamp: now,
    purpose: opts.purpose,
    ttl_minutes: ttl,
  }) + "\n";

  fs.appendFileSync(AUDIT_LOG, auditLine, { encoding: "utf8" });

  console.log(JSON.stringify({ status: "success", session_id: opts.session_id, expires_at: payload.expires_at }));
}

main();
