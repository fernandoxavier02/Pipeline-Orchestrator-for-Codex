export function classifyRequest(request: string) {
  const lower = request.toLowerCase();

  if (lower.includes("audit")) {
    return { type: "Audit", complexity: "MEDIA", variant: "audit-heavy" } as const;
  }

  if (lower.includes("fix") || lower.includes("bug")) {
    return { type: "Bug Fix", complexity: "MEDIA", variant: "bugfix-heavy" } as const;
  }

  if (lower.includes("story")) {
    return { type: "User Story", complexity: "COMPLEXA", variant: "user-story-heavy" } as const;
  }

  return { type: "Feature", complexity: "MEDIA", variant: "implement-heavy" } as const;
}
