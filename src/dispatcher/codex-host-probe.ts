import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Probe the Codex host configuration to determine if multi-agent support
 * (spawn_agent) is available. Reads ~/.codex/config.toml and checks
 * the features.multi_agent flag.
 *
 * Returns:
 *   - true  : multi_agent is explicitly enabled
 *   - false : multi_agent is explicitly disabled or config unreadable
 *   - null  : could not determine (config missing or parse error)
 */
export async function probeCodexMultiAgent(): Promise<boolean | null> {
  const configPath = join(homedir(), ".codex", "config.toml");
  try {
    const raw = await readFile(configPath, "utf8");
    // Simple TOML heuristic: look for `multi_agent = true|false` under [features]
    const featuresMatch = raw.match(/\[features\][^\[]*/);
    if (!featuresMatch) return null;

    const multiAgentMatch = featuresMatch[0].match(/multi_agent\s*=\s*(true|false)/);
    if (!multiAgentMatch) return null;

    return multiAgentMatch[1] === "true";
  } catch {
    return null;
  }
}
