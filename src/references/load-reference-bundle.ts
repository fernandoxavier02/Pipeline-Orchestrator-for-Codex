import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type {
  ChecklistId,
  ComplexityLabel,
  PipelineIntensity,
  PipelineTypeLabel,
  ReferenceBundle,
  ReferenceChecklist,
  ReferenceComplexityEntry,
  ReferenceGateBank,
  ReferencePipelineProfile,
  ReferenceTeamRegistry,
  ReferenceTeamRoute,
  TeamRouteMode,
} from "./reference-profiles.js";

const REFERENCE_PATHS = {
  complexityMatrix: "references/complexity-matrix.md",
  pipelinesDir: "references/pipelines",
  gatesDir: "references/gates",
  checklistsDir: "references/checklists",
  teamRegistry: "references/team-registry.md",
} as const;

const complexityMatrixSchema = z.object({
  kind: z.literal("complexity-matrix"),
  types: z.array(
    z.object({
      type: z.string().min(1),
      light: z.string().min(1),
      heavy: z.string().min(1),
    }),
  ),
});

const pipelineProfileSchema = z.object({
  kind: z.literal("pipeline-profile"),
  variant: z.string().min(1),
  type: z.string().min(1),
  complexity: z.string().min(1),
  intensity: z.string().min(1),
  batchSize: z.number().int().positive(),
  summary: z.string().min(1),
  checklists: z.array(z.string().min(1)).min(1),
});

const checklistSchema = z.object({
  kind: z.literal("checklist"),
  id: z.string().min(1),
  title: z.string().min(1),
  domains: z.array(z.string().min(1)).min(1),
  pathHints: z.array(z.string().min(1)).min(1),
  items: z.array(z.string().min(1)).min(1),
});

const gateBankSchema = z.object({
  kind: z.literal("gate-bank"),
  gate: z.string().min(1),
  questions: z.array(z.string().min(1)).optional(),
});

const teamRegistrySchema = z.object({
  kind: z.literal("team-registry"),
  routes: z.array(
    z.object({
      profile: z.string().min(1),
      type: z.string().min(1),
      intensity: z.string().min(1),
      mode: z.enum(["code-changing", "report-only", "review-fix"]),
      agents: z.array(z.string().min(1)).min(1),
      parallelGroups: z.array(z.array(z.string().min(1)).min(1)).default([]),
      skipInLight: z.array(z.string().min(1)).default([]),
      subRouteCondition: z.string().min(1).optional(),
    }),
  ).min(1),
});

const expectedComplexityByIntensity: Record<PipelineIntensity, ComplexityLabel> = {
  light: "MEDIA",
  heavy: "COMPLEXA",
};

function isMissingFile(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function readFrontmatter(contents: string, sourcePath: string) {
  const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`Missing YAML frontmatter in ${sourcePath}`);
  }

  const parsed = parseYaml(match[1]);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid YAML frontmatter in ${sourcePath}`);
  }

  return parsed as Record<string, unknown>;
}

async function readMarkdownFiles(rootDir: string, relativeDir: string) {
  const directory = join(rootDir, relativeDir);
  const entries = await readdir(directory, { withFileTypes: true });

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(directory, entry.name))
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    files.map(async (sourcePath) => ({
      sourcePath,
      frontmatter: readFrontmatter(await readFile(sourcePath, "utf8"), sourcePath),
    })),
  );
}

async function readReferenceFile(rootDir: string, relativePath: string) {
  const sourcePath = join(rootDir, relativePath);
  const contents = await readFile(sourcePath, "utf8");
  return { contents, sourcePath };
}

function normalizeComplexityMatrix(
  frontmatter: Record<string, unknown>,
  sourcePath: string,
): ReferenceComplexityEntry[] {
  const parsed = complexityMatrixSchema.parse(frontmatter);
  return parsed.types.map((entry) => ({
    type: entry.type as PipelineTypeLabel,
    light: entry.light,
    heavy: entry.heavy,
  }));
}

function normalizePipelineProfile(
  frontmatter: Record<string, unknown>,
  sourcePath: string,
): ReferencePipelineProfile {
  const parsed = pipelineProfileSchema.parse(frontmatter);
  return {
    ...parsed,
    type: parsed.type as PipelineTypeLabel,
    complexity: parsed.complexity as ComplexityLabel,
    intensity: parsed.intensity as PipelineIntensity,
    sourcePath,
  };
}

function normalizeChecklist(
  frontmatter: Record<string, unknown>,
  sourcePath: string,
): ReferenceChecklist {
  const parsed = checklistSchema.parse(frontmatter);
  return {
    ...parsed,
    sourcePath,
  };
}

function normalizeGateBank(
  frontmatter: Record<string, unknown>,
  sourcePath: string,
): ReferenceGateBank {
  const questions = Array.isArray(frontmatter.questions)
    ? frontmatter.questions
    : Array.isArray(frontmatter.checks)
      ? frontmatter.checks
      : [];

  const parsed = gateBankSchema.parse(frontmatter);
  return {
    ...parsed,
    gate: parsed.gate as "macro" | "micro",
    kind: "gate-bank",
    questions,
    sourcePath,
  };
}

function normalizeTeamRegistry(
  frontmatter: Record<string, unknown>,
  sourcePath: string,
): ReferenceTeamRegistry {
  const parsed = teamRegistrySchema.parse(frontmatter);

  return {
    kind: "team-registry",
    sourcePath,
    routes: parsed.routes.map((route): ReferenceTeamRoute => ({
      profile: route.profile,
      type: route.type as PipelineTypeLabel,
      intensity: route.intensity as PipelineIntensity,
      mode: route.mode as TeamRouteMode,
      agents: route.agents,
      parallelGroups: route.parallelGroups,
      skipInLight: route.skipInLight,
      subRouteCondition: route.subRouteCondition,
      sourcePath,
    })),
  };
}

function assertMatrixSemantics(
  matrix: ReferenceComplexityEntry[],
  profilesByVariant: Map<string, ReferencePipelineProfile>,
): Set<string> {
  const referencedVariants = new Set<string>();

  for (const row of matrix) {
    if (row.light === row.heavy) {
      throw new Error(`Matrix row for "${row.type}" maps both intensities to "${row.light}"`);
    }

    for (const intensity of ["light", "heavy"] as const) {
      const variant = row[intensity];
      const profile = profilesByVariant.get(variant);

      if (!profile) {
        throw new Error(
          `Matrix row for "${row.type}" points to missing ${intensity} profile "${variant}"`,
        );
      }

      referencedVariants.add(variant);

      if (profile.type !== row.type) {
        throw new Error(
          `Matrix row for "${row.type}" points ${intensity} to "${variant}", which declares type "${profile.type}"`,
        );
      }

      if (profile.intensity !== intensity) {
        throw new Error(
          `Profile "${variant}" declares intensity "${profile.intensity}" but is referenced as ${intensity}`,
        );
      }

      if (!profile.variant.endsWith(`-${intensity}`)) {
        throw new Error(
          `Profile "${variant}" does not use the expected -${intensity} suffix`,
        );
      }

      const expectedComplexity = expectedComplexityByIntensity[intensity];
      if (profile.complexity !== expectedComplexity) {
        throw new Error(
          `Profile "${variant}" has complexity "${profile.complexity}" but ${intensity} profiles must be "${expectedComplexity}"`,
        );
      }
    }
  }

  if (referencedVariants.size !== profilesByVariant.size) {
    return referencedVariants;
  }

  return referencedVariants;
}

function assertChecklistCoverage(
  profilesByVariant: Map<string, ReferencePipelineProfile>,
  checklistsById: Map<string, ReferenceChecklist>,
) {
  const usedChecklistIds = new Set<string>();

  for (const profile of profilesByVariant.values()) {
    for (const checklistId of profile.checklists) {
      if (!checklistsById.has(checklistId)) {
        throw new Error(
          `Reference bundle missing checklist "${checklistId}" for variant "${profile.variant}"`,
        );
      }
      usedChecklistIds.add(checklistId);
    }
  }

  const unusedChecklists = [...checklistsById.keys()].filter((id) => !usedChecklistIds.has(id));
  if (unusedChecklists.length > 0) {
    throw new Error(
      `Reference bundle contains unreferenced checklist files: ${unusedChecklists.join(", ")}`,
    );
  }
}

function assertGateCoverage(gatesByName: Map<string, ReferenceGateBank>) {
  const macro = gatesByName.get("macro");
  const micro = gatesByName.get("micro");

  if (!macro || !micro) {
    throw new Error("Reference bundle must define exactly one macro gate and one micro gate");
  }

  if (gatesByName.size !== 2) {
    const extras = [...gatesByName.keys()].filter((gate) => gate !== "macro" && gate !== "micro");
    if (extras.length > 0) {
      throw new Error(`Reference bundle contains unsupported gate files: ${extras.join(", ")}`);
    }
  }
}

function assertRequiredProfileCoverage(matrix: ReferenceComplexityEntry[], profilesByVariant: Map<string, ReferencePipelineProfile>) {
  const expectedVariants = new Set(matrix.flatMap((entry) => [entry.light, entry.heavy]));
  const actualVariants = new Set(profilesByVariant.keys());

  for (const variant of expectedVariants) {
    if (!actualVariants.has(variant)) {
      throw new Error(`Reference bundle missing pipeline profile "${variant}"`);
    }
  }
}

function resolveTeamRegistryProfile(
  route: ReferenceTeamRoute,
  profilesByVariant: Map<string, ReferencePipelineProfile>,
  matrixVariants: Set<string>,
) {
  const exactProfile = profilesByVariant.get(route.profile);
  if (exactProfile) {
    return exactProfile;
  }

  if (route.subRouteCondition) {
    throw new Error(`Team registry references unknown profile "${route.profile}"`);
  }

  const semanticMatches = [...profilesByVariant.values()].filter((profile) =>
    matrixVariants.has(profile.variant)
    && profile.type === route.type
    && profile.intensity === route.intensity,
  );

  if (semanticMatches.length !== 1) {
    throw new Error(`Team registry references unknown profile "${route.profile}"`);
  }

  route.profile = semanticMatches[0].variant;
  return semanticMatches[0];
}

function assertTeamRegistrySemantics(
  teamRegistry: ReferenceTeamRegistry,
  profilesByVariant: Map<string, ReferencePipelineProfile>,
  matrixVariants: Set<string>,
) {
  const seenProfiles = new Set<string>();

  for (const route of teamRegistry.routes) {
    const profile = resolveTeamRegistryProfile(route, profilesByVariant, matrixVariants);
    if (seenProfiles.has(profile.variant)) {
      throw new Error(`Team registry has duplicate profile "${profile.variant}"`);
    }
    seenProfiles.add(profile.variant);

    if (profile.type !== route.type) {
      throw new Error(
        `Team registry profile "${route.profile}" declares type "${route.type}" but the profile is "${profile.type}"`,
      );
    }

    if (profile.intensity !== route.intensity) {
      throw new Error(
        `Team registry profile "${route.profile}" declares intensity "${route.intensity}" but the profile is "${profile.intensity}"`,
      );
    }

    if (route.parallelGroups.some((group) => group.some((agent) => !route.agents.includes(agent)))) {
      throw new Error(
        `Team registry profile "${route.profile}" contains parallel groups with agents missing from its primary agent list`,
      );
    }

    if (route.intensity === "heavy" && route.skipInLight.length > 0) {
      throw new Error(`Heavy team route "${route.profile}" cannot define skipInLight agents`);
    }

    if (route.skipInLight.some((agent) => !route.agents.includes(agent))) {
      throw new Error(
        `Team registry profile "${route.profile}" lists skipInLight agents that are not present in the route`,
      );
    }
  }

  for (const variant of profilesByVariant.keys()) {
    if (!seenProfiles.has(variant)) {
      throw new Error(`Reference bundle missing team route for pipeline profile "${variant}"`);
    }
  }

  const subRoutedVariants = [...profilesByVariant.keys()].filter((variant) => !matrixVariants.has(variant));
  for (const variant of subRoutedVariants) {
    const route = teamRegistry.routes.find((entry) => entry.profile === variant);
    if (!route?.subRouteCondition) {
      throw new Error(
        `Sub-routed pipeline profile "${variant}" must declare a subRouteCondition in the team registry`,
      );
    }
  }
}

function assertNoDuplicateKeys(
  items: Array<{ key: string; sourcePath: string }>,
  kind: string,
) {
  const seen = new Set<string>();

  for (const item of items) {
    if (seen.has(item.key)) {
      throw new Error(`Reference bundle has duplicate ${kind} key "${item.key}"`);
    }
    seen.add(item.key);
  }
}

export async function loadReferenceBundle(rootDir: string): Promise<ReferenceBundle> {
  const { contents: matrixContents } = await readReferenceFile(rootDir, REFERENCE_PATHS.complexityMatrix);
  const complexityMatrix = normalizeComplexityMatrix(
    readFrontmatter(matrixContents, REFERENCE_PATHS.complexityMatrix),
    REFERENCE_PATHS.complexityMatrix,
  );

  const pipelineEntries = await readMarkdownFiles(rootDir, REFERENCE_PATHS.pipelinesDir);
  const pipelineProfiles = pipelineEntries.map(({ frontmatter, sourcePath }) =>
    normalizePipelineProfile(frontmatter, sourcePath),
  );
  assertNoDuplicateKeys(
    pipelineProfiles.map((profile) => ({ key: profile.variant, sourcePath: profile.sourcePath })),
    "pipeline profile",
  );
  const profilesByVariant = new Map(pipelineProfiles.map((profile) => [profile.variant, profile] as const));

  const gateEntries = await readMarkdownFiles(rootDir, REFERENCE_PATHS.gatesDir);
  const gates = gateEntries.map(({ frontmatter, sourcePath }) => normalizeGateBank(frontmatter, sourcePath));
  assertNoDuplicateKeys(
    gates.map((gate) => ({ key: gate.gate, sourcePath: gate.sourcePath })),
    "gate",
  );
  const gatesByName = new Map(gates.map((gate) => [gate.gate, gate] as const));

  const checklistEntries = await readMarkdownFiles(rootDir, REFERENCE_PATHS.checklistsDir);
  const checklists = checklistEntries.map(({ frontmatter, sourcePath }) =>
    normalizeChecklist(frontmatter, sourcePath),
  );
  assertNoDuplicateKeys(
    checklists.map((checklist) => ({ key: checklist.id, sourcePath: checklist.sourcePath })),
    "checklist",
  );
  const checklistsById = new Map(checklists.map((checklist) => [checklist.id, checklist] as const));

  const { contents: teamRegistryContents, sourcePath: teamRegistrySourcePath } = await readReferenceFile(
    rootDir,
    REFERENCE_PATHS.teamRegistry,
  );
  const teamRegistry = normalizeTeamRegistry(
    readFrontmatter(teamRegistryContents, teamRegistrySourcePath),
    teamRegistrySourcePath,
  );

  const matrixVariants = assertMatrixSemantics(complexityMatrix, profilesByVariant);
  assertRequiredProfileCoverage(complexityMatrix, profilesByVariant);
  assertChecklistCoverage(profilesByVariant, checklistsById);
  assertGateCoverage(gatesByName);
  assertTeamRegistrySemantics(teamRegistry, profilesByVariant, matrixVariants);

  return {
    rootDir,
    complexityMatrix,
    pipelineProfiles: Object.fromEntries(profilesByVariant) as ReferenceBundle["pipelineProfiles"],
    gates: {
      macro: gatesByName.get("macro")!,
      micro: gatesByName.get("micro")!,
    },
    checklists: Object.fromEntries(checklistsById) as ReferenceBundle["checklists"],
    teamRegistry,
  };
}
