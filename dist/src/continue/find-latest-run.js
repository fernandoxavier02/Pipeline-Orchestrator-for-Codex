import { access, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
async function pathExists(path) {
    try {
        await access(path);
        return true;
    }
    catch {
        return false;
    }
}
async function getLatestActivityAt(runDir) {
    const candidates = [
        join(runDir, "session.json"),
        join(runDir, "gate-decisions.jsonl"),
        join(runDir, "confidence-score.yaml"),
        join(runDir, "confidence-score.json"),
    ];
    let latest = 0;
    for (const candidate of candidates) {
        if (!(await pathExists(candidate))) {
            continue;
        }
        const stats = await stat(candidate);
        latest = Math.max(latest, stats.mtimeMs);
    }
    const checkpointsDir = join(runDir, "checkpoints");
    if (await pathExists(checkpointsDir)) {
        const checkpointEntries = await readdir(checkpointsDir, { withFileTypes: true });
        for (const entry of checkpointEntries) {
            if (!entry.isFile()) {
                continue;
            }
            const checkpointStats = await stat(join(checkpointsDir, entry.name));
            latest = Math.max(latest, checkpointStats.mtimeMs);
        }
    }
    if (latest > 0) {
        return latest;
    }
    const dirStats = await stat(runDir);
    return dirStats.mtimeMs;
}
async function collectRunDirs(root, acc = []) {
    const entries = await readdir(root, { withFileTypes: true });
    const hasSession = entries.some((entry) => entry.isFile() && entry.name === "session.json");
    const hasGateLog = entries.some((entry) => entry.isFile() && entry.name === "gate-decisions.jsonl");
    const hasConfidence = entries.some((entry) => entry.isFile() && entry.name === "confidence-score.yaml")
        || entries.some((entry) => entry.isFile() && entry.name === "confidence-score.json");
    if (hasSession || hasGateLog || hasConfidence) {
        acc.push(root);
    }
    for (const entry of entries) {
        if (entry.isDirectory()) {
            await collectRunDirs(join(root, entry.name), acc);
        }
    }
    return acc;
}
export async function findLatestRun(root) {
    const candidates = await collectRunDirs(root);
    if (candidates.length === 0) {
        return null;
    }
    const scored = await Promise.all(candidates.map(async (runDir) => ({
        runDir,
        lastActivityAt: await getLatestActivityAt(runDir),
    })));
    scored.sort((left, right) => right.lastActivityAt - left.lastActivityAt);
    const latest = scored[0];
    return {
        runDir: latest.runDir,
        sessionPath: join(latest.runDir, "session.json"),
        gateLogPath: join(latest.runDir, "gate-decisions.jsonl"),
        checkpointDir: join(latest.runDir, "checkpoints"),
        lastActivityAt: new Date(latest.lastActivityAt).toISOString(),
    };
}
