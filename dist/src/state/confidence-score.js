import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { confidenceScoreSchema } from "../domain/pipeline-schemas.js";
import { writeFileAtomic } from "./atomic-write.js";
import { resolveValidatedRoot } from "./path-validation.js";
export function createConfidenceScoreStore(root) {
    const validatedRoot = resolveValidatedRoot(root);
    const yamlFile = join(validatedRoot, "confidence-score.yaml");
    const legacyJsonFile = join(validatedRoot, "confidence-score.json");
    return {
        root: validatedRoot,
        async save(snapshot) {
            const parsed = confidenceScoreSchema.parse(snapshot);
            await writeFileAtomic(yamlFile, YAML.stringify(parsed));
        },
        async load() {
            try {
                const raw = await readFile(yamlFile, "utf8");
                return confidenceScoreSchema.parse(YAML.parse(raw));
            }
            catch (error) {
                if (error instanceof Error && "code" in error && error.code === "ENOENT") {
                    const raw = await readFile(legacyJsonFile, "utf8");
                    return confidenceScoreSchema.parse(JSON.parse(raw));
                }
                throw error;
            }
        },
    };
}
