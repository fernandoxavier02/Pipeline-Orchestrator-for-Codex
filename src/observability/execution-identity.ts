import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type ExecutionIdentity = Readonly<{
  trace_id: string;
  workflow_id: string;
  event_id: string;
  plugin_name: string;
  plugin_version: string;
  runtime: "codex" | "claude-code" | "unknown";
  surface: string;
  cwd: string;
  pid: number;
  node_version: string;
  timestamp: string;
  session_id?: string;
  state_root?: string;
  plugin_root?: string;
  source?: string;
}>;

type PluginMetadata = {
  name: string;
  version: string;
  root?: string;
};

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function findUp(start: string, relativePath: string): string | undefined {
  let current = resolve(start);

  for (;;) {
    const candidate = join(current, relativePath);
    if (existsSync(candidate)) {
      return candidate;
    }

    const next = dirname(current);
    if (next === current) {
      return undefined;
    }
    current = next;
  }
}

function readPluginMetadata(input: {
  cwd: string;
  pluginRoot?: string;
  pluginName?: string;
  pluginVersion?: string;
}): PluginMetadata {
  const roots = [
    input.pluginRoot,
    process.env.CODEX_PLUGIN_ROOT,
    process.env.CLAUDE_PLUGIN_ROOT,
  ].filter((entry): entry is string => typeof entry === "string" && entry.length > 0);

  for (const root of roots) {
    const manifest = readJson(join(root, ".codex-plugin", "plugin.json"));
    if (manifest) {
      return {
        name: typeof manifest.name === "string" ? manifest.name : input.pluginName ?? "unknown-plugin",
        version: typeof manifest.version === "string" ? manifest.version : input.pluginVersion ?? "0.0.0",
        root,
      };
    }
  }

  const manifestPath = findUp(input.cwd, join(".codex-plugin", "plugin.json"));
  const manifest = manifestPath ? readJson(manifestPath) : undefined;
  if (manifest) {
    return {
      name: typeof manifest.name === "string" ? manifest.name : input.pluginName ?? "unknown-plugin",
      version: typeof manifest.version === "string" ? manifest.version : input.pluginVersion ?? "0.0.0",
      root: dirname(dirname(manifestPath as string)),
    };
  }

  const packagePath = findUp(input.cwd, "package.json");
  const pkg = packagePath ? readJson(packagePath) : undefined;
  return {
    name: input.pluginName ?? (typeof pkg?.name === "string" ? pkg.name : "unknown-plugin"),
    version: input.pluginVersion ?? (typeof pkg?.version === "string" ? pkg.version : "0.0.0"),
    root: packagePath ? dirname(packagePath) : undefined,
  };
}

function resolveRuntime(): ExecutionIdentity["runtime"] {
  if (process.env.CODEX_HOME || process.env.CODEX_PLUGIN_ROOT) {
    return "codex";
  }
  if (process.env.CLAUDE_PLUGIN_ROOT || process.env.CLAUDECODE) {
    return "claude-code";
  }
  return "unknown";
}

function buildHashId(prefix: string, parts: Array<string | number | undefined>) {
  const hash = createHash("sha256")
    .update(parts.map((part) => part ?? "").join("\0"))
    .digest("base64url")
    .slice(0, 18);

  return `${prefix}-${hash}`;
}

function buildTraceId(input: {
  pluginName: string;
  pluginVersion: string;
  sessionId?: string;
  stateRoot?: string;
  cwd: string;
  pid: number;
}) {
  return buildHashId("pipe", [
      input.pluginName,
      input.pluginVersion,
      input.stateRoot ? resolve(input.stateRoot) : undefined,
      input.stateRoot ? "" : input.sessionId ?? "",
      input.stateRoot ? "" : input.cwd,
      input.stateRoot ? "" : input.pid,
    ]);
}

function buildEventId(input: {
  traceId: string;
  surface: string;
  timestamp: string;
  pid: number;
}) {
  return buildHashId("evt", [
    input.traceId,
    input.surface,
    input.timestamp,
    input.pid,
  ]);
}

export function createExecutionIdentity(input: {
  surface: string;
  traceId?: string;
  workflowId?: string;
  sessionId?: string;
  cwd?: string;
  stateRoot?: string;
  pluginRoot?: string;
  pluginName?: string;
  pluginVersion?: string;
  eventKey?: string;
  source?: string;
  timestamp?: string;
}): ExecutionIdentity {
  const cwd = resolve(input.cwd ?? process.cwd());
  const timestamp = input.timestamp ?? new Date().toISOString();
  const metadata = readPluginMetadata({
    cwd,
    pluginRoot: input.pluginRoot,
    pluginName: input.pluginName,
    pluginVersion: input.pluginVersion,
  });
  const traceId = input.traceId ?? input.workflowId ?? buildTraceId({
    pluginName: metadata.name,
    pluginVersion: metadata.version,
    sessionId: input.sessionId,
    stateRoot: input.stateRoot,
    cwd,
    pid: process.pid,
  });
  const workflowId = input.workflowId ?? traceId;

  return Object.freeze({
    trace_id: traceId,
    workflow_id: workflowId,
    event_id: buildEventId({
      traceId,
      surface: input.eventKey ? `${input.surface}:${input.eventKey}` : input.surface,
      timestamp,
      pid: process.pid,
    }),
    plugin_name: metadata.name,
    plugin_version: metadata.version,
    runtime: resolveRuntime(),
    surface: input.surface,
    cwd,
    pid: process.pid,
    node_version: process.version,
    timestamp,
    ...(input.sessionId ? { session_id: input.sessionId } : {}),
    ...(input.stateRoot ? { state_root: resolve(input.stateRoot) } : {}),
    ...(metadata.root ? { plugin_root: resolve(metadata.root) } : {}),
    ...(input.source ? { source: input.source } : {}),
  });
}
