import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const commands = [
  ["Type contracts", "npm", ["run", "lint:types"]],
  ["Build output", "npm", ["run", "build"]],
  ["Pipeline contract tests", "npm", ["run", "test:pipeline-contracts"]],
];

const npmCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");

for (const [label, command, args] of commands) {
  console.log(`[pipeline-contract-watchdog] ${label}`);
  const hasNpmCli = command === "npm" && existsSync(npmCli);
  const executable = hasNpmCli ? process.execPath : command;
  const executableArgs = hasNpmCli ? [npmCli, ...args] : args;
  const result = spawnSync(executable, executableArgs, {
    stdio: "inherit",
  });

  if (result.status !== 0) {
    const status = result.status ?? 1;
    console.error(`[pipeline-contract-watchdog] FAILED: ${label} exited with ${status}`);
    process.exit(status);
  }
}

console.log("[pipeline-contract-watchdog] PASS");
