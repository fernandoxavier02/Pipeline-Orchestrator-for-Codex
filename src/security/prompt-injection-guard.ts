function toSingleLine(content: string) {
  return content.replace(/\s+/g, " ").trim();
}

const INJECTION_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\bignore (?:all |any |the )?(?:previous|prior|above) instructions\b/i,
    reason: "Repo prompts cannot override upstream controller instructions.",
  },
  {
    pattern: /\boverride controller authority\b/i,
    reason: "Repo prompts cannot override controller authority.",
  },
  {
    pattern: /\b(?:repository|repo) prompt\b.{0,80}\b(?:highest|primary|sole)\s+authority\b/i,
    reason: "Repo prompts cannot declare themselves the highest authority.",
  },
  {
    pattern: /\b(?:treat|consider|use)\b.{0,40}\b(?:this|the)?\s*(?:repository|repo) prompt\b.{0,80}\b(?:authoritative|authority|higher[-\s]priority|supersed\w+)\b.{0,80}\bcontroller (?:rules|instructions|authority)\b/i,
    reason: "Repo prompts cannot supersede controller rules or authority.",
  },
  {
    pattern: /\b(?:system|developer) prompt\b/i,
    reason: "Repo prompts cannot redefine higher-priority prompt authority.",
  },
];

export function assertPromptInjectionSafe(input: {
  name: string;
  content: string;
}) {
  const normalized = toSingleLine(input.content);

  for (const rule of INJECTION_PATTERNS) {
    if (rule.pattern.test(normalized)) {
      throw new Error(`Prompt injection guard rejected "${input.name}": ${rule.reason}`);
    }
  }
}
