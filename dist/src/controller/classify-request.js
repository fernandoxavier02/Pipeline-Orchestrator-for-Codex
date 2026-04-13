const FALLBACK_VARIANTS = {
    Feature: "implement-light",
    "Bug Fix": "bugfix-heavy",
    Audit: "audit-heavy",
    "User Story": "user-story-heavy",
    "UX Simulation": "ux-sim-heavy",
};
export function classifyRequest(request, referenceIndex) {
    const lower = request.toLowerCase();
    const adversarialRequested = /\b(adversarial|threat model|security audit|red team)\b/.test(lower);
    const explicitlySimple = /\b(simple|small|tiny|quick)\b/.test(lower);
    const explicitlyComplex = /\b(complex|critical|security|boundary|platform|workflow|journey|system|cross[- ]cutting)\b/.test(lower);
    const route = (type, intensity = "heavy") => {
        const profile = referenceIndex
            ? referenceIndex.getPipelineProfileForRoute(type, intensity)
            : { variant: FALLBACK_VARIANTS[type], type, complexity: intensity === "heavy" ? "COMPLEXA" : "MEDIA" };
        return {
            ...profile,
            routeFamily: adversarialRequested ? "adversarial" : "standard",
            adversarialRequested,
        };
    };
    const resolveIntensity = (defaultsToHeavy) => {
        if (explicitlySimple) {
            return "light";
        }
        if (explicitlyComplex) {
            return "heavy";
        }
        return defaultsToHeavy ? "heavy" : "light";
    };
    if (adversarialRequested || lower.includes("audit")) {
        return route("Audit", resolveIntensity(true));
    }
    if (lower.includes("fix") || lower.includes("bug")) {
        return route("Bug Fix", resolveIntensity(true));
    }
    if (lower.includes("story")) {
        return route("User Story", resolveIntensity(true));
    }
    if (lower.includes("ux") || lower.includes("journey") || lower.includes("simulation")) {
        return route("UX Simulation", resolveIntensity(true));
    }
    return route("Feature", resolveIntensity(false));
}
