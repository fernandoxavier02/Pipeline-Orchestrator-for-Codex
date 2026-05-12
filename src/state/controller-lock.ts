import { mkdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { controllerRevalidationLockSchema } from "../domain/pipeline-schemas.js";
import { writeFileAtomic } from "./atomic-write.js";
import { resolveValidatedRoot } from "./path-validation.js";

export function createControllerLockStore(root: string) {
  const validatedRoot = resolveValidatedRoot(root);
  const file = join(validatedRoot, "controller-lock.json");

  return {
    root: validatedRoot,
    async save(lock: unknown) {
      const parsed = controllerRevalidationLockSchema.parse(lock);

      await mkdir(root, { recursive: true });
      await writeFileAtomic(file, JSON.stringify(parsed));
    },
    async load() {
      try {
        const raw = await readFile(file, "utf8");
        return controllerRevalidationLockSchema.parse(JSON.parse(raw));
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          return null;
        }

        throw error;
      }
    },
    async clear() {
      try {
        await unlink(file);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          return;
        }

        throw error;
      }
    },
  };
}
