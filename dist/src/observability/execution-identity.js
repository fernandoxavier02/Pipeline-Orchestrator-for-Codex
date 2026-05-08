import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
function readJson(path) {
    try {
        return JSON.parse(readFileSync(path, "utf8"));
    }
    catch {
        return undefined;
    }
}
function findUp(start, relativePath) {
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
function readPluginMetadata(input) {
    const roots = [
        input.pluginRoot,
        process.env.CODEX_PLUGIN_ROOT,
        process.env.CLAUDE_PLUGIN_ROOT,
    ].filter((entry) => typeof entry === "string" && entry.length > 0);
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
            root: dirname(dirname(manifestPath)),
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
function resolveRuntime() {
    if (process.env.CODEX_HOME || process.env.CODEX_PLUGIN_ROOT) {
        return "codex";
    }
    if (process.env.CLAUDE_PLUGIN_ROOT || process.env.CLAUDECODE) {
        return "claude-code";
    }
    return "unknown";
}
function buildHashId(prefix, parts) {
    const hash = createHash("sha256")
        .update(parts.map((part) => part ?? "").join("\0"))
        .digest("base64url")
        .slice(0, 18);
    return `${prefix}-${hash}`;
}
function buildTraceId(input) {
    return buildHashId("pipe", [
        input.pluginName,
        input.pluginVersion,
        input.stateRoot ? resolve(input.stateRoot) : undefined,
        input.stateRoot ? "" : input.sessionId ?? "",
        input.stateRoot ? "" : input.cwd,
        input.stateRoot ? "" : input.pid,
    ]);
}
function buildEventId(input) {
    return buildHashId("evt", [
        input.traceId,
        input.surface,
        input.timestamp,
        input.pid,
    ]);
}
export function createExecutionIdentity(input) {
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
