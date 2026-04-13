export type PersistedVerificationEvidence = Array<{
  kind: string;
  passed: boolean;
  label?: string;
}>;

export type PersistedCloseout = {
  decision: "GO" | "CONDITIONAL" | "NO-GO";
  confidenceScore: number;
  confidenceBand: "low" | "medium" | "high";
  missingEvidence: string[];
  blockingGates: string[];
  skippedSoftGates: string[];
  blockedReviews: number;
  rollbackHint?: string | null;
  verificationEvidence: PersistedVerificationEvidence;
  updatedAt: string;
};

export type PersistedCloseoutPackage = {
  closeout: PersistedCloseout;
  renderInput: {
    closeout: PersistedCloseout;
    batches: Array<{ name: string }>;
    validationIntent?: string;
  };
};

export function buildPersistedCloseout(input: {
  validation: {
    decision: PersistedCloseout["decision"];
    confidenceScore: number;
    confidenceBand: PersistedCloseout["confidenceBand"];
    missingEvidence: string[];
    blockingGates: string[];
    skippedSoftGates: string[];
    blockedReviews: number;
    rollbackHint?: string | null;
  };
  verificationEvidence: PersistedVerificationEvidence;
  batches: Array<{ name: string }>;
  validationIntent?: string;
  updatedAt: string;
}): PersistedCloseoutPackage {
  const closeout: PersistedCloseout = {
    decision: input.validation.decision,
    confidenceScore: input.validation.confidenceScore,
    confidenceBand: input.validation.confidenceBand,
    missingEvidence: [...input.validation.missingEvidence],
    blockingGates: [...input.validation.blockingGates],
    skippedSoftGates: [...input.validation.skippedSoftGates],
    blockedReviews: input.validation.blockedReviews,
    rollbackHint: input.validation.rollbackHint,
    verificationEvidence: input.verificationEvidence.map((evidence) => ({ ...evidence })),
    updatedAt: input.updatedAt,
  };

  return {
    closeout,
    renderInput: {
      closeout,
      batches: [...input.batches],
      validationIntent: input.validationIntent,
    },
  };
}
