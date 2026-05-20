import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type ExecWindow, parseExecWindow } from "./exec-window.js";

const SESSIONS_DIRNAME = "sessions";
const EXEC_WINDOW_SUFFIX = ".exec-window";
const SESSION_FILENAME_PREFIX = "session-";

function encodeSessionId(sessionId: string): string {
  return `${SESSION_FILENAME_PREFIX}${Buffer.from(sessionId, "utf8").toString("base64url")}`;
}

export function execWindowDir(stateRoot: string): string {
  return join(stateRoot, SESSIONS_DIRNAME);
}

const MAX_SESSION_ID_LENGTH = 512;

export function execWindowPath(stateRoot: string, sessionId: string): string {
  if (!sessionId) throw new Error("execWindowPath: sessionId is required");
  if (sessionId.length > MAX_SESSION_ID_LENGTH) {
    throw new Error(`execWindowPath: sessionId exceeds ${MAX_SESSION_ID_LENGTH} characters`);
  }
  // base64url encoding produces only [A-Za-z0-9_-] — filesystem-safe and injective.
  // No sanitization needed; raw input maps 1:1 to its encoded form.
  return join(execWindowDir(stateRoot), `${encodeSessionId(sessionId)}${EXEC_WINDOW_SUFFIX}`);
}

export function readExecWindow(path: string): ExecWindow | null {
  if (!existsSync(path)) return null;
  try {
    return parseExecWindow(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function writeExecWindowAtomic(path: string, window: ExecWindow): void {
  // Reject symlinks — prevents symlink-escape attacks
  if (existsSync(path)) {
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) {
      throw new Error(`SECURITY: exec-window path is a symlink: ${path}`);
    }
  }

  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(window), "utf8");
  // Windows-safe: renameSync overwrites existing files since Node v6.
  // Do NOT unlink first — that creates a non-atomic window.
  // Retry once on transient EPERM/EEXIST (AV scanners, competing handles).
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      renameSync(tmp, path);
      return;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (attempt === 0 && (code === "EEXIST" || code === "EPERM")) {
        // eslint-disable-next-line no-loop-func
        const start = Date.now();
        while (Date.now() - start < 50) { /* busy-wait 50ms */ }
        continue;
      }
      throw error;
    }
  }
}

export function deleteExecWindow(path: string): boolean {
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

export function createExecWindowStore(stateRoot: string) {
  return {
    root: stateRoot,
    pathFor(sessionId: string) {
      return execWindowPath(stateRoot, sessionId);
    },
    read(sessionId: string) {
      return readExecWindow(execWindowPath(stateRoot, sessionId));
    },
    write(sessionId: string, window: ExecWindow) {
      writeExecWindowAtomic(execWindowPath(stateRoot, sessionId), window);
    },
    delete(sessionId: string) {
      return deleteExecWindow(execWindowPath(stateRoot, sessionId));
    },
  };
}
