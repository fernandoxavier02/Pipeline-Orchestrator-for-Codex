export function runFinalValidator(input: {
  reviews: Array<{ status: string }>;
  confidenceScore: number;
}) {
  const hasBlockedReview = input.reviews.some(
    (review) => review.status !== "approved",
  );
  const hasEnoughConfidence = input.confidenceScore >= 0.7;

  return {
    status: !hasBlockedReview && hasEnoughConfidence ? "go" : "no-go",
  };
}
