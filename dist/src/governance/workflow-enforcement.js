export const REQUIRED_WORKFLOW_GATES = [
    "CAPABILITY_GATE",
    "INTAKE_GATE",
    "SCOPE_GATE",
    "EVIDENCE_GATE",
    "ADVERSARIAL_GATE",
    "FINAL_VERDICT_GATE",
];
const CHECKPOINT_PHASES = [
    "intake",
    "planning",
    "agent_dispatch",
    "artifact_collection",
    "adversarial_review",
    "final_verdict",
];
export const REQUIRED_WORKFLOW_HOOKS = CHECKPOINT_PHASES.flatMap((phase) => [
    `${phase}:before`,
    `${phase}:after`,
]);
const PHASE_ORDER = {
    "phase-0": 0,
    "phase-1": 1,
    "phase-1.5": 2,
    "phase-2": 3,
    "phase-3": 4,
    continue: 5,
};
function eventKey(kind, id) {
    return `${kind}:${id}`;
}
function requiredAgentRoles(input) {
    return [
        ...(input.requireAdversarialReview ? ["primary_reviewer", "adversarial_reviewer"] : []),
        ...(input.requireSecurityReview ? ["security_reviewer"] : []),
    ];
}
function toWorkflowStatus(status) {
    return status === "PASS" ? "PASS" : status === "FAIL" ? "FAIL" : "BLOCKED";
}
function normalizePhase(phase, fallback) {
    if (phase === "phase-0"
        || phase === "phase-1"
        || phase === "phase-1.5"
        || phase === "phase-2"
        || phase === "phase-3"
        || phase === "continue") {
        return phase;
    }
    return fallback;
}
function sequenceErrorsFor(events) {
    const errors = [];
    let highestSeen = Number.NEGATIVE_INFINITY;
    let highestPhase;
    for (const event of events) {
        const current = PHASE_ORDER[event.phase];
        if (current < highestSeen) {
            errors.push(`phase regression: ${event.kind}:${event.id} at ${event.phase} after ${highestPhase}`);
            continue;
        }
        highestSeen = current;
        highestPhase = event.phase;
    }
    return errors;
}
export function evaluateWorkflowEvidence(input) {
    const byKey = new Map(input.events.map((event) => [eventKey(event.kind, event.id), event]));
    const missingEvents = [];
    const failedEvents = [];
    for (const gate of input.requiredGates ?? REQUIRED_WORKFLOW_GATES) {
        const key = eventKey("gate", gate);
        const event = byKey.get(key);
        if (!event) {
            missingEvents.push(key);
        }
        else if (event.status !== "PASS") {
            failedEvents.push(key);
        }
    }
    for (const hook of input.requiredHooks ?? REQUIRED_WORKFLOW_HOOKS) {
        const key = eventKey("hook", hook);
        const event = byKey.get(key);
        if (!event) {
            missingEvents.push(key);
        }
        else if (event.status !== "PASS") {
            failedEvents.push(key);
        }
    }
    for (const role of requiredAgentRoles(input)) {
        const key = eventKey("agent", role);
        const event = byKey.get(key);
        if (!event || event.independent !== true) {
            missingEvents.push(key);
        }
        else if (event.status !== "PASS") {
            failedEvents.push(key);
        }
    }
    const finalVerdict = byKey.get(eventKey("final_verdict", "final_verdict"));
    if (!finalVerdict) {
        missingEvents.push(eventKey("final_verdict", "final_verdict"));
    }
    else if (finalVerdict.status !== "PASS") {
        failedEvents.push(eventKey("final_verdict", "final_verdict"));
    }
    const sequenceErrors = sequenceErrorsFor(input.events);
    return {
        status: missingEvents.length === 0 && failedEvents.length === 0 && sequenceErrors.length === 0
            ? "PASS"
            : "BLOCKED",
        missingEvents,
        failedEvents,
        sequenceErrors,
    };
}
export function requiredWorkflowEventsFromArtifact(artifact) {
    return [
        ...(artifact.agents ?? []).map((agent) => ({
            kind: "agent",
            id: agent.role,
            phase: normalizePhase(agent.phase, "phase-2"),
            status: toWorkflowStatus(agent.status),
            independent: agent.independent,
        })),
        ...(artifact.gates ?? []).map((gate) => ({
            kind: "gate",
            id: gate.gate,
            phase: normalizePhase(gate.phase, "phase-3"),
            status: toWorkflowStatus(gate.status),
        })),
        ...(artifact.hooks ?? []).map((hook) => ({
            kind: "hook",
            id: hook.checkpoint,
            phase: normalizePhase(hook.phase, "phase-3"),
            status: toWorkflowStatus(hook.status),
        })),
        {
            kind: "final_verdict",
            id: "final_verdict",
            phase: normalizePhase(artifact.final_verdict?.phase, "phase-3"),
            status: toWorkflowStatus(artifact.final_verdict?.status),
        },
    ];
}
