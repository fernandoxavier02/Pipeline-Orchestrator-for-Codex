import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
const REQUIRED_SECTIONS = [
    "## Classification",
    "## Pipeline Definition (snapshot)",
    "## Execution Log",
    "## Final Verdict",
];
const REQUIRED_HEADER_FIELDS = [
    "trace_schema_version",
    "timestamp_utc",
    "started_at",
    "ended_at",
    "duration_seconds",
    "plugin_version",
    "user_identity",
    "branch",
    "repo",
    "task",
];
export function generateTrace(input) {
    const endedAt = input.endedAt ?? new Date().toISOString();
    const startedAt = input.startedAt ?? endedAt;
    const durationSeconds = Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000));
    const status = input.finalVerdict === "GO"
        ? "SUCCESS"
        : input.finalVerdict === "CONDITIONAL"
            ? "DONE_WITH_CONCERNS"
            : "BLOCKED";
    const phases = input.executionLog.length > 0 ? input.executionLog : ["closeout:no execution events recorded"];
    return [
        `# Pipeline Run: ${input.runId}`,
        "",
        "- trace_schema_version: 1",
        `- timestamp_utc: ${endedAt}`,
        `- started_at: ${startedAt}`,
        `- ended_at: ${endedAt}`,
        `- duration_seconds: ${Number.isFinite(durationSeconds) ? durationSeconds : 0}`,
        `- plugin_version: ${input.pluginVersion ?? "0.4.1"}`,
        `- user_identity: ${input.userIdentity ?? "unknown"}`,
        `- branch: ${input.branch ?? "(no-git)"}`,
        `- repo: ${input.repo ?? "(local)"}`,
        `- task: ${(input.task ?? input.runId).slice(0, 200)}`,
        "",
        "## Classification",
        "",
        `- type: ${input.classification.type}`,
        `- type_source: ${input.classification.typeSource ?? "auto via /pipeline-orchestrator-for-codex:pipeline"}`,
        `- complexity: ${input.classification.complexity}`,
        `- complexity_source: ${input.classification.complexitySource ?? input.classification.variant}`,
        `- justification: ${input.classification.justification ?? "Runtime closeout trace generated from authoritative pipeline state."}`,
        "",
        "## Pipeline Definition (snapshot)",
        "",
        input.pipeline.snapshot ?? [
            `- mode: ${input.pipeline.mode}`,
            `- dispatch_mode: ${input.pipeline.dispatchMode}`,
        ].join("\n"),
        "",
        "## Execution Log",
        "",
        phases.map((entry, index) => [
            `### Phase: phase-${index}`,
            `- started_at: ${startedAt}`,
            `- ended_at: ${endedAt}`,
            "- agents: []",
            "- gate_before: (none) -> SKIPPED",
            "- artifacts_produced: []",
            `- status: ${status === "BLOCKED" ? "FAILURE" : "SUCCESS"}`,
            `- dispatch_mode: ${input.pipeline.dispatchMode}`,
            `- dispatch_decision_reason: ${entry}`,
            "- emergent_invocations: []",
        ].join("\n")).join("\n\n"),
        "",
        "## Final Verdict",
        "",
        `- status: ${status}`,
        `- artifacts: [${(input.artifacts ?? []).join(", ")}]`,
        `- open_issues: [${(input.openIssues ?? []).join(", ")}]`,
        `- recommended_next: ${input.recommendedNext ?? "Review TRACE.md together with the closeout decision."}`,
        "",
    ].join("\n");
}
export function validateTrace(trace) {
    const errors = [];
    for (const field of REQUIRED_HEADER_FIELDS) {
        if (!new RegExp(`^-\\s*${field}:\\s*\\S`, "m").test(trace)) {
            errors.push(`Missing required header field: ${field}.`);
        }
    }
    const schemaMatch = trace.match(/-\s*trace_schema_version:\s*(\S+)/);
    if (!schemaMatch) {
        errors.push("Missing trace_schema_version: 1 header field.");
    }
    else if (schemaMatch[1] !== "1") {
        errors.push(`Unsupported trace_schema_version: ${schemaMatch[1]}.`);
    }
    for (const section of REQUIRED_SECTIONS) {
        if (!trace.includes(section)) {
            errors.push(`Missing required section: ${section}`);
        }
    }
    const positions = REQUIRED_SECTIONS.map((section) => trace.indexOf(section));
    if (positions.some((position) => position < 0)) {
        return { valid: false, errors };
    }
    for (let index = 1; index < positions.length; index += 1) {
        if (positions[index] <= positions[index - 1]) {
            errors.push("Required sections are out of order.");
            break;
        }
    }
    if (!/## Execution Log[\s\S]*### Phase:\s*\S+/.test(trace)) {
        errors.push("Execution Log must contain at least one phase entry.");
    }
    if (!/## Final Verdict[\s\S]*-\s*status:\s*(SUCCESS|DONE_WITH_CONCERNS|BLOCKED)/.test(trace)) {
        errors.push("Final verdict status must be SUCCESS, DONE_WITH_CONCERNS, or BLOCKED.");
    }
    if (trace.includes("## Plan Mode")) {
        for (const field of ["plan_mode_skipped", "plan_override_attempted", "justification"]) {
            if (!new RegExp(`## Plan Mode[\\s\\S]*-\\s*${field}:\\s*\\S`).test(trace)) {
                errors.push(`Plan Mode is missing required field: ${field}.`);
            }
        }
    }
    return {
        valid: errors.length === 0,
        errors,
    };
}
export async function writeTrace(path, input) {
    const trace = generateTrace(input);
    const validation = validateTrace(trace);
    if (!validation.valid) {
        throw new Error(`Generated TRACE.md is invalid: ${validation.errors.join("; ")}`);
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, trace, "utf8");
    return trace;
}
