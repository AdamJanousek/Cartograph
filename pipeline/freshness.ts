import { createHash } from "node:crypto";
import { fetchFileAt, headCommit, type Repository } from "./fetch.ts";

// Whether the map is still of the repository as it is now. Asked of GitHub on
// each explanation, because an explanation of code that has since changed
// should say so.

export type Freshness =
  | { state: "current" }
  /** The repository moved on, but this file is byte-for-byte what was parsed. */
  | { state: "moved"; head: string }
  | { state: "changed"; head: string }
  | { state: "removed"; head: string }
  /** The check itself couldn't run. Said plainly rather than shown as current. */
  | { state: "unknown"; reason: string };

/** `file` is null for a folder, which is only checked against the commit. */
export async function checkFreshness(
  repository: Repository,
  analysedSha: string,
  file: { path: string; hash: string } | null,
): Promise<Freshness> {
  try {
    const head = await headCommit(repository);
    if (head === analysedSha) return { state: "current" };
    if (!file) return { state: "moved", head };
    const bytes = await fetchFileAt(repository, head, file.path);
    if (!bytes) return { state: "removed", head };
    const hash = createHash("sha256").update(bytes).digest("hex");
    return { state: hash === file.hash ? "moved" : "changed", head };
  } catch (error) {
    return { state: "unknown", reason: error instanceof Error ? error.message : String(error) };
  }
}
