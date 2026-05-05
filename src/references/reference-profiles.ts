export type PipelineTypeLabel = "Feature" | "Bug Fix" | "User Story" | "Audit" | "UX Simulation" | "Spec";
export type ComplexityLabel = "SIMPLES" | "MEDIA" | "COMPLEXA";
export type PipelineIntensity = "light" | "heavy";
export type ChecklistId = string;
export type PipelineVariant = string;
export type TeamRouteMode = "code-changing" | "report-only" | "review-fix";

export interface ReferenceComplexityEntry {
  type: PipelineTypeLabel;
  light: PipelineVariant;
  heavy: PipelineVariant;
}

export interface ReferenceChecklist {
  id: ChecklistId;
  title: string;
  domains: string[];
  pathHints: string[];
  items: string[];
  sourcePath: string;
}

export interface ReferenceGateBank {
  kind: "gate-bank";
  gate: "macro" | "micro";
  questions: string[];
  sourcePath: string;
}

export interface ReferencePipelineProfile {
  variant: PipelineVariant;
  type: PipelineTypeLabel;
  complexity: ComplexityLabel;
  intensity: PipelineIntensity;
  batchSize: number;
  summary: string;
  checklists: ChecklistId[];
  sourcePath: string;
}

export interface ReferenceTeamRoute {
  profile: PipelineVariant;
  type: PipelineTypeLabel;
  intensity: PipelineIntensity;
  mode: TeamRouteMode;
  agents: string[];
  parallelGroups: string[][];
  skipInLight: string[];
  subRouteCondition?: string;
  sourcePath: string;
}

export interface ReferenceTeamRegistry {
  kind: "team-registry";
  routes: ReferenceTeamRoute[];
  sourcePath: string;
}

export interface ReferenceBundle {
  rootDir: string;
  complexityMatrix: ReferenceComplexityEntry[];
  pipelineProfiles: Record<PipelineVariant, ReferencePipelineProfile>;
  gates: {
    macro: ReferenceGateBank;
    micro: ReferenceGateBank;
  };
  checklists: Record<string, ReferenceChecklist>;
  teamRegistry: ReferenceTeamRegistry;
}

export interface ReferenceProfileIndex {
  getPipelineProfile(variant: PipelineVariant): ReferencePipelineProfile;
  getPipelineProfileForRoute(type: PipelineTypeLabel, intensity: PipelineIntensity): ReferencePipelineProfile;
  getTeamRoute(profile: PipelineVariant): ReferenceTeamRoute;
  getGateQuestions(kind: "macro" | "micro"): string[];
  selectChecklistIdsForTouchedPaths(paths: string[]): ChecklistId[];
  selectChecklistsForTouchedPaths(paths: string[]): ReferenceChecklist[];
}

function normalizePath(path: string) {
  return path.toLowerCase().replaceAll("\\", "/");
}

function pathMatchesChecklist(path: string, checklist: ReferenceChecklist) {
  const normalized = normalizePath(path);
  return checklist.pathHints.some((hint) => normalized.includes(normalizePath(hint)))
    || checklist.domains.some((domain) => normalized.includes(normalizePath(domain)));
}

export function resolveReferenceProfile(bundle: ReferenceBundle, variant: PipelineVariant) {
  const profile = bundle.pipelineProfiles[variant];
  if (!profile) {
    const supported = Object.keys(bundle.pipelineProfiles).join(", ");
    throw new Error(`Unknown pipeline profile "${variant}". Supported variants: ${supported}`);
  }

  return profile;
}

export function resolveReferenceProfileForRoute(
  bundle: ReferenceBundle,
  type: PipelineTypeLabel,
  intensity: PipelineIntensity,
) {
  const row = bundle.complexityMatrix.find((entry) => entry.type === type);
  if (!row) {
    throw new Error(`Unknown pipeline type "${type}"`);
  }

  const variant = row[intensity];
  return resolveReferenceProfile(bundle, variant);
}

export function getReferenceGateQuestions(bundle: ReferenceBundle, kind: "macro" | "micro") {
  return bundle.gates[kind].questions;
}

export function resolveTeamRoute(bundle: ReferenceBundle, profile: PipelineVariant) {
  const route = bundle.teamRegistry.routes.find((entry) => entry.profile === profile);
  if (!route) {
    const supported = bundle.teamRegistry.routes.map((entry) => entry.profile).join(", ");
    throw new Error(`Unknown team route "${profile}". Supported profiles: ${supported}`);
  }

  return route;
}

export function selectChecklistIdsForTouchedPaths(
  bundle: ReferenceBundle,
  paths: string[],
): ChecklistId[] {
  const selected = new Set<ChecklistId>();

  for (const checklist of Object.values(bundle.checklists)) {
    if (paths.some((path) => pathMatchesChecklist(path, checklist))) {
      selected.add(checklist.id);
    }
  }

  return [...selected].sort();
}

export function selectChecklistsForTouchedPaths(
  bundle: ReferenceBundle,
  paths: string[],
): ReferenceChecklist[] {
  return selectChecklistIdsForTouchedPaths(bundle, paths).map((id) => bundle.checklists[id]);
}

export function createReferenceProfileIndex(bundle: ReferenceBundle): ReferenceProfileIndex {
  return {
    getPipelineProfile(variant) {
      return resolveReferenceProfile(bundle, variant);
    },
    getPipelineProfileForRoute(type, intensity) {
      return resolveReferenceProfileForRoute(bundle, type, intensity);
    },
    getTeamRoute(profile) {
      return resolveTeamRoute(bundle, profile);
    },
    getGateQuestions(kind) {
      return getReferenceGateQuestions(bundle, kind);
    },
    selectChecklistIdsForTouchedPaths(paths) {
      return selectChecklistIdsForTouchedPaths(bundle, paths);
    },
    selectChecklistsForTouchedPaths(paths) {
      return selectChecklistsForTouchedPaths(bundle, paths);
    },
  };
}
