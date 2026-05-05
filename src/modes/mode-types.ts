export type InfoGateScope = "full" | "blocker-only";
export type PaDeCalPolicy = "standard" | "reduced";

export interface TddPolicy {
  minimumTests: number;
  regressionOnly: boolean;
}

export interface SanityPolicy {
  runBuild: boolean;
  runTests: boolean;
  runFullRegression: boolean;
}

export interface UserConfirmationPolicy {
  questions: number;
  kind: "full-proposal-plus-plan" | "emergency-confirmation";
}

export interface ForcedClassification {
  type: "Bug Fix" | "Feature" | "User Story" | "Audit" | "UX Simulation" | "Spec";
  complexity: "SIMPLES" | "MEDIA" | "COMPLEXA";
  severity: "Critical" | "High" | "Medium" | "Low";
}

export interface ReductionPolicy {
  infoGate: InfoGateScope;
  userConfirmation: UserConfirmationPolicy;
  tdd: TddPolicy;
  adversarialChecklists: string[];
  sanity: SanityPolicy;
  paDeCal: PaDeCalPolicy;
  batchSize: number;
  forcedClassification: ForcedClassification;
}
