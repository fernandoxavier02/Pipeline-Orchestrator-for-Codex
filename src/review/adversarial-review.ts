export async function runAdversarialReview(input: {
  batch: { name: string; files: string[] };
  findings: Array<{ severity: string }>;
}) {
  const blocking = input.findings.some(
    (finding) =>
      finding.severity === "critical" || finding.severity === "important",
  );

  return {
    batch: input.batch.name,
    status: blocking ? "blocked" : "approved",
    findings: input.findings,
  };
}
