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

  // Windows-safe: renameSync overwrites existing files since Node v6.
  // Do NOT unlink first — that creates a non-atomic window where the file
  // is missing between unlink and rename.
  try {
    await rename(tmp, path);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    // On Windows EPERM/EEXIST, retry once after a short delay
    if (code === "EEXIST" || code === "EPERM") {
      await new Promise((r) => setTimeout(r, 50));
      await rename(tmp, path);
    } else {
      throw error;
    }
  }
}
