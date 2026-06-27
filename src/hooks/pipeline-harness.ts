export const PIPELINE_PLUGIN_SLUG = "pipeline-orchestrator-for-codex";
export const PIPELINE_WORKFLOW = "pipeline";
const COMMON_PLUGIN_TAIL_WORDS = new Set(["audit", "review", "feature", "spec", "bugfix"]);

export type FirstMessageHarnessSource =
  | "pipeline-slash-command"
  | "generic-slash-command"
  | "plugin-mention"
  | "plugin-mention-default";

export interface FirstMessageHarnessInput {
  prompt: string;
  governedWorkflows?: readonly string[];
}

export interface FirstMessageHarnessDecision {
  triggered: boolean;
  workflow: string;
  source: FirstMessageHarnessSource;
  trigger: string;
}

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function governedSet(workflows?: readonly string[]): Set<string> {
  return new Set((workflows || []).map((entry) => normalizeText(entry)).filter(Boolean));
}

export function normalizeHarnessWorkflow(name: string | undefined, workflows?: readonly string[]): string | undefined {
  const normalized = normalizeText(name || "");
  if (!normalized) return undefined;
  if (governedSet(workflows).has(normalized)) return normalized;
  return undefined;
}

export function detectSlashCommand(prompt: string): string | undefined {
  const match = prompt.match(/(?:^|\s)(\/[A-Za-z0-9][A-Za-z0-9_:-]*)(?=$|[\s,.;:!?])/u);
  return match?.[1];
}

export function detectPipelineSlashWorkflow(prompt: string, workflows?: readonly string[]): string | undefined {
  const match = prompt.match(/(?:^|\s)\/pipeline-orchestrator(?:-for-codex)?:(?<workflow>[a-z0-9-]+)\b/iu);
  return normalizeHarnessWorkflow(match?.groups?.workflow, workflows);
}

export function detectPipelinePluginMention(prompt: string): RegExpMatchArray | undefined {
  const slug = escapeRegex(PIPELINE_PLUGIN_SLUG);
  const canonicalUri = `${slug}(?=[)@/?#])[^)]*`;
  const display = "pipeline\\s+orchestrator(?:\\s+for\\s+codex)?";
  const mentionBoundary = "(?=$|[\\s,.;:!?])";
  const patterns = [
    new RegExp(`\\[(?:[@$])?${slug}\\]\\((?:plugin|app):\\/\\/${canonicalUri}\\)(?<tail>[\\s\\S]*)`, "iu"),
    new RegExp(`\\[(?:[@$])?${display}\\]\\((?:plugin|app):\\/\\/${canonicalUri}\\)(?<tail>[\\s\\S]*)`, "iu"),
    new RegExp(`(?:^|\\s)[@$]${slug}${mentionBoundary}(?<tail>[\\s\\S]*)`, "iu"),
    new RegExp(`(?:^|\\s)[@$]${display}${mentionBoundary}(?<tail>[\\s\\S]*)`, "iu"),
    new RegExp(`#plugin\\s+${slug}${mentionBoundary}(?<tail>[\\s\\S]*)`, "iu"),
    new RegExp(`#plugin\\s+${display}${mentionBoundary}(?<tail>[\\s\\S]*)`, "iu"),
  ];

  return patterns.map((pattern) => prompt.match(pattern)).find((match): match is RegExpMatchArray => Boolean(match));
}

export function detectWorkflowAfterMention(tail: string | undefined, workflows?: readonly string[]): string | undefined {
  if (!tail) return undefined;
  const match = tail.trimStart().match(/^(?<workflow>[a-z0-9-]+)(?=$|[\s,.;:!?])/iu);
  const workflow = normalizeHarnessWorkflow(match?.groups?.workflow, workflows);
  if (!workflow || COMMON_PLUGIN_TAIL_WORDS.has(workflow)) return undefined;
  return workflow;
}

export function decideFirstMessageHarness(input: FirstMessageHarnessInput): FirstMessageHarnessDecision | undefined {
  const prompt = input.prompt || "";
  if (!prompt.trim()) return undefined;

  const pipelineWorkflow = detectPipelineSlashWorkflow(prompt, input.governedWorkflows);
  if (pipelineWorkflow) {
    return {
      triggered: true,
      workflow: pipelineWorkflow,
      source: "pipeline-slash-command",
      trigger: `/pipeline-orchestrator-for-codex:${pipelineWorkflow}`,
    };
  }

  const mention = detectPipelinePluginMention(prompt);
  if (mention) {
    const workflow = detectWorkflowAfterMention(mention.groups?.tail, input.governedWorkflows);
    return {
      triggered: true,
      workflow: workflow || PIPELINE_WORKFLOW,
      source: workflow ? "plugin-mention" : "plugin-mention-default",
      trigger: "pipeline-plugin-mention",
    };
  }

  const slash = detectSlashCommand(prompt);
  if (slash) {
    return {
      triggered: true,
      workflow: PIPELINE_WORKFLOW,
      source: "generic-slash-command",
      trigger: slash,
    };
  }

  return undefined;
}
