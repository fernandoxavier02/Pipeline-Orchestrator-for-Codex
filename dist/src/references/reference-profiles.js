function normalizePath(path) {
    return path.toLowerCase().replaceAll("\\", "/");
}
function pathMatchesChecklist(path, checklist) {
    const normalized = normalizePath(path);
    return checklist.pathHints.some((hint) => normalized.includes(normalizePath(hint)))
        || checklist.domains.some((domain) => normalized.includes(normalizePath(domain)));
}
export function resolveReferenceProfile(bundle, variant) {
    const profile = bundle.pipelineProfiles[variant];
    if (!profile) {
        const supported = Object.keys(bundle.pipelineProfiles).join(", ");
        throw new Error(`Unknown pipeline profile "${variant}". Supported variants: ${supported}`);
    }
    return profile;
}
export function resolveReferenceProfileForRoute(bundle, type, intensity) {
    const row = bundle.complexityMatrix.find((entry) => entry.type === type);
    if (!row) {
        throw new Error(`Unknown pipeline type "${type}"`);
    }
    const variant = row[intensity];
    return resolveReferenceProfile(bundle, variant);
}
export function getReferenceGateQuestions(bundle, kind) {
    return bundle.gates[kind].questions;
}
export function resolveTeamRoute(bundle, profile) {
    const route = bundle.teamRegistry.routes.find((entry) => entry.profile === profile);
    if (!route) {
        const supported = bundle.teamRegistry.routes.map((entry) => entry.profile).join(", ");
        throw new Error(`Unknown team route "${profile}". Supported profiles: ${supported}`);
    }
    return route;
}
export function selectChecklistIdsForTouchedPaths(bundle, paths) {
    const selected = new Set();
    for (const checklist of Object.values(bundle.checklists)) {
        if (paths.some((path) => pathMatchesChecklist(path, checklist))) {
            selected.add(checklist.id);
        }
    }
    return [...selected].sort();
}
export function selectChecklistsForTouchedPaths(bundle, paths) {
    return selectChecklistIdsForTouchedPaths(bundle, paths).map((id) => bundle.checklists[id]);
}
export function createReferenceProfileIndex(bundle) {
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
