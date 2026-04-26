import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sessionStateSchema } from "../domain/pipeline-schemas.js";
import { writeFileAtomic } from "./atomic-write.js";
export function createSessionStore(root) {
    const file = join(root, "session.json");
    return {
        root,
        async save(session) {
            const parsed = sessionStateSchema.parse(session);
            await writeFileAtomic(file, JSON.stringify(parsed));
        },
        async load() {
            const raw = await readFile(file, "utf8");
            return sessionStateSchema.parse(JSON.parse(raw));
        },
    };
}
