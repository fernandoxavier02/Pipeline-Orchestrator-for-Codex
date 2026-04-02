import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { controllerRevalidationLockSchema } from "../domain/pipeline-schemas.js";
export function createControllerLockStore(root) {
    const file = join(root, "controller-lock.json");
    return {
        root,
        async save(lock) {
            const parsed = controllerRevalidationLockSchema.parse(lock);
            await mkdir(root, { recursive: true });
            await writeFile(file, JSON.stringify(parsed), "utf8");
        },
        async load() {
            try {
                const raw = await readFile(file, "utf8");
                return controllerRevalidationLockSchema.parse(JSON.parse(raw));
            }
            catch (error) {
                if (error instanceof Error && "code" in error && error.code === "ENOENT") {
                    return null;
                }
                throw error;
            }
        },
        async clear() {
            try {
                await unlink(file);
            }
            catch (error) {
                if (error instanceof Error && "code" in error && error.code === "ENOENT") {
                    return;
                }
                throw error;
            }
        },
    };
}
