import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Windows-safe atomic write of an entire file.
 *
 * Pattern: write to <path>.tmp, unlink <path> if it exists (Windows
 * does not support atomic `rename` over an existing target on every
 * filesystem), then rename .tmp into place. The caller MUST treat the
 * payload as the complete new file content; this is not for appends.
 */
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, content, "utf8");
  try {
    await unlink(path);
  } catch {
    // ignore: target may not exist yet
  }
  await rename(tmp, path);
}
