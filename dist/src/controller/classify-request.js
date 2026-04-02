const FALLBACK_VARIANTS = {
    Feature: "implement-light",
    "Bug Fix": "bugfix-heavy",
    Audit: "audit-heavy",
    "User Story": "user-story-heavy",
    "UX Simulation": "ux-sim-heavy",
};
export function classifyRequest(request, referenceIndex) {
    const lower = request.toLowerCase();
    const route = (type, intensity = "heavy") => referenceIndex
        ? referenceIndex.getPipelineProfileForRoute(type, intensity)
        : { variant: FALLBACK_VARIANTS[type], type, complexity: "COMPLEXA" };
    if (lower.includes("audit")) {
        return route("Audit");
    }
    if (lower.includes("fix") || lower.includes("bug")) {
        return route("Bug Fix");
    }
    if (lower.includes("story")) {
        return route("User Story");
    }
    return referenceIndex
        ? referenceIndex.getPipelineProfileForRoute("Feature", "light")
        : { variant: FALLBACK_VARIANTS.Feature, type: "Feature", complexity: "MEDIA" };
}
