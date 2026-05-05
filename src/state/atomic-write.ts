import { randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Windows-safe atomic write of an entire file.
 *
 * Pattern: write to a unique <path>.*.tmp, unlink <path> if it exists
 * (Windows does not support atomic `rename` over an existing target on
 * every filesystem), then rename the temp file into place. The caller
 * MUST treat the payload as the complete new file content; this is not
 * for appends.
 */
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, content, "utf8");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await unlink(path);
    } catch {
      // ignore: target may not exist yet
    }

    try {
      await rename(tmp, path);
      return;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (attempt < 2 && (code === "EEXIST" || code === "EPERM")) {
        continue;
      }
      throw error;
    }
  }
}
