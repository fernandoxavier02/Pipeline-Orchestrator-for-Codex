#!/usr/bin/env node
/**
 * validate-exec-window.cjs
 * Validate whether an exec-window is open and within TTL bounds.
 * Usage: node validate-exec-window.cjs --session-id=<id>
 */

const fs = require("fs");
const path = require("path");

const SESSIONS_DIR = path.join(".pipeline", "sessions");

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
    console.log(JSON.stringify({ status: "invalid", reason: "exec-window does not exist" }));
    process.exit(0);
  }

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
  } catch (e) {
    console.log(JSON.stringify({ status: "invalid", reason: "exec-window file is malformed JSON" }));
    process.exit(0);
  }

  const now = Date.now();
  if (!payload.expires_at || payload.expires_at < now) {
    console.log(JSON.stringify({ status: "invalid", reason: "exec-window has expired", expired_at: payload.expires_at }));
    process.exit(0);
  }

  if (!payload.ttl_minutes || payload.ttl_minutes <= 0 || payload.ttl_minutes > 60) {
    console.log(JSON.stringify({ status: "invalid", reason: "exec-window TTL is out of bounds" }));
    process.exit(0);
  }

  console.log(JSON.stringify({
    status: "valid",
    session_id,
    purpose: payload.purpose,
    expires_at: payload.expires_at,
    remaining_seconds: Math.floor((payload.expires_at - now) / 1000),
  }));
}

main();
