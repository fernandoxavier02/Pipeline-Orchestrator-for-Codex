import { readFile } from "node:fs/promises";
import { join } from "node:path";

function isMissingFile(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function createPromptRegistry(root: string) {
  return {
    async load(name: string) {
      const directFile = join(root, "prompts", `${name}.md`);

      try {
        return await readFile(directFile, "utf8");
      } catch (error) {
        if (!isMissingFile(error)) {
          throw error;
        }
      }

      const agentFile = join(root, "prompts", "agents", `${name}.md`);
      return readFile(agentFile, "utf8");
    },
  };
}
