import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { createExecutionIdentity } from "../observability/execution-identity.js";

const protocolKindSchema = z.enum(["GATE_REQUEST", "DISPATCH_REQUEST", "PLAN_MODE_REQUEST"]);

const baseProtocolBlockSchema = z.object({
  kind: protocolKindSchema,
  protocol_version: z.literal(1),
  source: z.string().default("unknown"),
});

const gateOptionSchema = z.object({
  label: z.string().min(1),
  description: z.string().min(1, "GATE_REQUEST options require a non-empty trade-off description"),
  recommended: z.boolean().default(false),
});

export const gateRequestBlockSchema = baseProtocolBlockSchema.extend({
  kind: z.literal("GATE_REQUEST"),
  gate_id: z.string().min(1),
  question: z.string().min(1),
  header: z.string().max(12).optional(),
  multi_select: z.boolean().default(false),
  options: z.array(gateOptionSchema)
    .min(2, "GATE_REQUEST questions require at least two meaningful options")
    .refine(
      (options) => options.filter((option) => option.recommended).length <= 1,
      "GATE_REQUEST questions may mark at most one option as recommended",
    ),
  context: z.string().optional(),
});

export const dispatchRequestBlockSchema = baseProtocolBlockSchema.extend({
  kind: z.literal("DISPATCH_REQUEST"),
  dispatch_id: z.string().min(1),
  target_kind: z.enum(["agent", "skill"]),
  target_name: z.string().min(1),
  description: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  context_for_parent: z.string().optional(),
  phase: z.string().min(1).default("unknown"),
});

export const planModeRequestBlockSchema = baseProtocolBlockSchema.extend({
  kind: z.literal("PLAN_MODE_REQUEST"),
  plan_id: z.string().min(1),
  research_scope: z.string().min(1),
  expected_deliverables: z.array(z.string().min(1)).default([]),
});

export const protocolBlockSchema = z.discriminatedUnion("kind", [
  gateRequestBlockSchema,
  dispatchRequestBlockSchema,
  planModeRequestBlockSchema,
]);

export type ProtocolBlock = z.infer<typeof protocolBlockSchema>;

export const protocolEventSchema = z.object({
  event_id: z.string().min(1),
  kind: protocolKindSchema.optional(),
  event: protocolKindSchema.optional(),
  protocol_version: z.literal(1),
  status: z.enum(["emitted", "answered", "dispatched", "completed", "failed"]),
  source: z.string().min(1),
  timestamp: z.string().min(1),
  payload: z.record(z.unknown()),
  execution_identity: z.object({
    trace_id: z.string(),
    workflow_id: z.string(),
    event_id: z.string(),
    plugin_name: z.string(),
    plugin_version: z.string(),
    runtime: z.enum(["codex", "claude-code", "unknown"]),
    surface: z.string(),
    cwd: z.string(),
    pid: z.number().int(),
    node_version: z.string(),
    timestamp: z.string(),
    session_id: z.string().optional(),
    state_root: z.string().optional(),
    plugin_root: z.string().optional(),
    source: z.string().optional(),
  }).optional(),
}).transform((event) => ({
  ...event,
  kind: event.kind ?? event.event,
})).pipe(z.object({
  event_id: z.string().min(1),
  kind: protocolKindSchema,
  event: protocolKindSchema.optional(),
  protocol_version: z.literal(1),
  status: z.enum(["emitted", "answered", "dispatched", "completed", "failed"]),
  source: z.string().min(1),
  timestamp: z.string().min(1),
  payload: z.record(z.unknown()),
  execution_identity: z.object({
    trace_id: z.string(),
    workflow_id: z.string(),
    event_id: z.string(),
    plugin_name: z.string(),
    plugin_version: z.string(),
    runtime: z.enum(["codex", "claude-code", "unknown"]),
    surface: z.string(),
    cwd: z.string(),
    pid: z.number().int(),
    node_version: z.string(),
    timestamp: z.string(),
    session_id: z.string().optional(),
    state_root: z.string().optional(),
    plugin_root: z.string().optional(),
    source: z.string().optional(),
  }).optional(),
}));

export type ProtocolEvent = z.infer<typeof protocolEventSchema>;

const BLOCK_PATTERN = /=== (GATE_REQUEST|DISPATCH_REQUEST|PLAN_MODE_REQUEST) v1 ===\r?\n([\s\S]*?)\r?\n=== END \1 ===/g;

function normalizeRawBlock(kind: ProtocolBlock["kind"], raw: unknown) {
  const parsed = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  if (kind === "PLAN_MODE_REQUEST" && "request_id" in parsed && !("plan_id" in parsed)) {
    parsed.plan_id = parsed.request_id;
  }
  if (kind === "PLAN_MODE_REQUEST" && "reason" in parsed && !("research_scope" in parsed)) {
    parsed.research_scope = parsed.reason;
  }
  return {
    kind,
    protocol_version: 1,
    ...parsed,
  };
}

export function parseProtocolBlocks(text: string): ProtocolBlock[] {
  const blocks: ProtocolBlock[] = [];

  for (const match of text.matchAll(BLOCK_PATTERN)) {
    const [, kind, body] = match;
    const parsedYaml = YAML.parse(body);
    blocks.push(protocolBlockSchema.parse(normalizeRawBlock(kind as ProtocolBlock["kind"], parsedYaml)));
  }

  return blocks;
}

export function createProtocolEventLog(root: string) {
  const file = join(root, "protocol-events.jsonl");

  return {
    root,
    async append(event: unknown) {
      const parsed = protocolEventSchema.parse(event);
      const enriched = {
        ...parsed,
        execution_identity: parsed.execution_identity ?? createExecutionIdentity({
          surface: "protocol-events",
          cwd: process.cwd(),
          stateRoot: root,
          source: "runtime",
        }),
      };

      await mkdir(root, { recursive: true });
      await appendFile(file, `${JSON.stringify(enriched)}\n`, "utf8");
    },
    async list() {
      try {
        const raw = await readFile(file, "utf8");
        return raw
          .split("\n")
          .filter((line) => line.length > 0)
          .map((line) => protocolEventSchema.parse(JSON.parse(line)));
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          return [];
        }

        throw error;
      }
    },
  };
}
