function toSingleLine(content) {
    return content.replace(/\s+/g, " ").trim();
}
function normalizeUnicode(content) {
    // NFKC normalization collapses compatibility characters (e.g., full-width, circled)
    // and helps detect homoglyph attacks.
    try {
        return content.normalize("NFKC");
    }
    catch {
        return content;
    }
}
function hasMixedScripts(content) {
    // Detect mixed-script strings (e.g., Cyrillic homoglyphs in Latin text).
    // This is a lightweight heuristic: if we see both Latin and Cyrillic, flag it.
    const cyrillic = /[\u0400-\u04FF]/;
    const latin = /[a-zA-Z]/;
    return latin.test(content) && cyrillic.test(content);
}
const INJECTION_PATTERNS = [
    {
        pattern: /\bignore (?:all |any |the )?(?:previous|prior|above) instructions?\b/i,
        reason: "Repo prompts cannot override upstream controller instructions.",
    },
    {
        pattern: /\bdisregard (?:all |any |the )?(?:previous|prior|above) (?:instructions?|directives?)\b/i,
        reason: "Repo prompts cannot override upstream controller instructions.",
    },
    {
        pattern: /\bforget (?:all |everything )?(?:previous|prior|above)\b/i,
        reason: "Repo prompts cannot override upstream controller instructions.",
    },
    {
        pattern: /\boverride (?:all |any |the )?(?:previous|prior|above)?\s*(?:controller )?(?:authority|instructions?)\b/i,
        reason: "Repo prompts cannot override controller authority.",
    },
    {
        pattern: /\bsupersede (?:all |any |the )?(?:previous|prior|above)?\s*(?:controller )?(?:authority|instructions?)\b/i,
        reason: "Repo prompts cannot override controller authority.",
    },
    {
        pattern: /\bnew priority\b|\byour new priority is\b/i,
        reason: "Repo prompts cannot reassign controller priority.",
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
    {
        pattern: /\byou (?:are |have become |now have )(?:the |a )?(?:new |highest |primary |sole )?(?:system |developer )?(?:admin|authority|priority)\b/i,
        reason: "Repo prompts cannot claim elevated system authority.",
    },
];
export function assertPromptInjectionSafe(input) {
    // 1. Unicode normalization and mixed-script detection
    const normalized = normalizeUnicode(toSingleLine(input.content));
    if (hasMixedScripts(normalized)) {
        throw new Error(`Prompt injection guard rejected "${input.name}": Mixed-script text detected (possible homoglyph attack).`);
    }
    // 2. Pattern matching
    for (const rule of INJECTION_PATTERNS) {
        if (rule.pattern.test(normalized)) {
            throw new Error(`Prompt injection guard rejected "${input.name}": ${rule.reason}`);
        }
    }
}
/**
 * Scan an arbitrary object for prompt injection payloads.
 * Recursively walks strings and arrays, applying the same guard.
 * Uses a WeakSet to prevent infinite recursion on cyclic objects.
 */
export function scanObjectForPromptInjection(input, path = "root", seen) {
    if (typeof input === "string") {
        assertPromptInjectionSafe({ name: path, content: input });
        return;
    }
    if (Array.isArray(input)) {
        const s = seen ?? new WeakSet();
        if (s.has(input))
            return;
        s.add(input);
        for (let i = 0; i < input.length; i += 1) {
            scanObjectForPromptInjection(input[i], `${path}[${i}]`, s);
        }
        return;
    }
    if (input && typeof input === "object") {
        const s = seen ?? new WeakSet();
        if (s.has(input))
            return;
        s.add(input);
        for (const [key, value] of Object.entries(input)) {
            scanObjectForPromptInjection(value, `${path}.${key}`, s);
        }
    }
}
