import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function writePolymarketArtifact(
  artifactRootPath: string | null,
  segments: string[],
  payload: unknown,
): Promise<string | null> {
  if (!artifactRootPath) return null;
  const directory = join(artifactRootPath, "artifacts", ...segments.slice(0, -1));
  const filename = join(artifactRootPath, "artifacts", ...segments);
  await mkdir(directory, { recursive: true });
  await writeFile(filename, JSON.stringify(payload, null, 2), "utf8");
  return filename;
}
