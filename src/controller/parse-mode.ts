import type { PipelineMode } from "../domain/pipeline-types.js";

export function parseMode(input: string): { mode: PipelineMode; normalizedRequest: string } {
  const trimmedInput = input.trim();
  const prefixes: Array<{ prefix: string; mode: PipelineMode }> = [
    { prefix: "/pipeline diagnostic ", mode: "diagnostic" },
    { prefix: "/pipeline continue", mode: "continue" },
    { prefix: "/pipeline review-only ", mode: "review-only" },
    { prefix: "/pipeline --simples ", mode: "--simples" },
    { prefix: "/pipeline --media ", mode: "--media" },
    { prefix: "/pipeline --complexa ", mode: "--complexa" },
    { prefix: "/pipeline --plan ", mode: "--plan" },
    { prefix: "/pipeline --grill ", mode: "--grill" },
    { prefix: "/pipeline --hotfix ", mode: "--hotfix" },
  ];

  for (const { prefix, mode } of prefixes) {
    if (trimmedInput === prefix.trimEnd()) {
      return { mode, normalizedRequest: "" };
    }

    if (trimmedInput.startsWith(prefix)) {
      return {
        mode,
        normalizedRequest: trimmedInput.slice(prefix.length).trimStart(),
      };
    }
  }

  if (trimmedInput.startsWith("/pipeline ")) {
    return {
      mode: "full",
      normalizedRequest: trimmedInput.slice("/pipeline ".length).trimStart(),
    };
  }

  return {
    mode: "full",
    normalizedRequest: trimmedInput,
  };
}
