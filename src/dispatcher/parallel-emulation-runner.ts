import { runSingleAgentRole } from "./single-agent-runner.js";
import type { DispatchMode } from "./dispatcher-types.js";
import type { DispatchRequest, DispatchResult, DispatchTeamMember } from "./dispatcher-types.js";
import { createExecutionIdentity } from "../observability/execution-identity.js";

type Finding = {
  id?: string;
  severity?: string;
  summary?: string;
  file?: string;
  reviewer?: string;
};

function normalizeTeam(request: DispatchRequest): DispatchTeamMember[] {
  if (request.team?.length) {
    return request.team;
  }

  return [
    {
      role: request.role,
      prompt: request.prompt,
      input: request.input,
      freshContext: request.freshContext,
      reviewOnly: request.reviewOnly,
      filesInScope: request.filesInScope,
      authorityLevel: request.authorityLevel,
    },
  ];
}

function collectFindings(dispatches: DispatchResult[]) {
  return dispatches.flatMap((dispatch) => {
    const findings =
      dispatch.output
      && typeof dispatch.output === "object"
      && "findings" in dispatch.output
      && Array.isArray(dispatch.output.findings)
        ? dispatch.output.findings as Finding[]
        : [];

    return findings.map((finding) => ({
      ...finding,
      reviewer: finding.reviewer ?? dispatch.role,
    }));
  });
}

function resolveStatus(dispatches: DispatchResult[], findings: Finding[]) {
  const blockedByChild = dispatches.some((dispatch) =>
    dispatch.output
    && typeof dispatch.output === "object"
    && "status" in dispatch.output
    && dispatch.output.status === "blocked",
  );
  const blockedByFinding = findings.some((finding) =>
    finding.severity === "critical" || finding.severity === "important",
  );

  return blockedByChild || blockedByFinding ? "blocked" : "approved";
}

export async function runParallelEmulation(request: DispatchRequest): Promise<DispatchResult> {
  const team = normalizeTeam(request);
  const dispatches = await Promise.all(
    team.map(async (member, index) => {
      const executionIdentity = createExecutionIdentity({
        surface: `dispatch:${member.role}`,
        traceId: request.executionIdentity?.trace_id,
        workflowId: request.executionIdentity?.workflow_id,
        sessionId: request.sessionId,
        stateRoot: request.sessionRoot,
        eventKey: `child-${index}`,
        source: "parallel-emulation-child",
      });
      const dispatch = await runSingleAgentRole({
        mode: "single-agent",
        role: member.role,
        prompt: member.prompt,
        input: member.input,
        freshContext: member.freshContext ?? true,
        reviewOnly: member.reviewOnly ?? request.reviewOnly ?? false,
        filesInScope: member.filesInScope ?? request.filesInScope,
        authorityLevel: member.authorityLevel ?? request.authorityLevel ?? "reviewer",
        sessionRoot: request.sessionRoot,
        sessionId: request.sessionId,
        executionIdentity,
      });

      return {
        ...dispatch,
        executionIdentity,
        output: {
          ...dispatch.output,
          executionIdentity,
        },
      };
    }),
  );
  const findings = collectFindings(dispatches);

  return {
    mode: "parallel-emulation" as DispatchMode,
    role: request.role,
    output: {
      status: resolveStatus(dispatches, findings),
      findings,
      agents: dispatches.map((dispatch) => ({
        role: dispatch.role,
        executionIdentity: dispatch.executionIdentity,
        output: dispatch.output,
      })),
      reviewOnly: request.reviewOnly ?? false,
      freshContextRequired: true,
      filesInScope: request.filesInScope ?? [],
      authorityLevel: request.authorityLevel ?? "reviewer",
    },
  };
}
