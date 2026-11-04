import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { extract, type ReadEntry } from "tar";

export interface Repository {
  owner: string;
  name: string;
}

export interface Archive {
  /** The repository's contents, with GitHub's top-level folder stripped. */
  directory: string;
  /** The commit GitHub built the archive from, as the archive itself records it. */
  commitSha: string;
  remove: () => Promise<void>;
}

// Parsing happens inside a request, so a repository past these is a limit to
// state, not one to work around. The second guards against an archive that is
// small on the wire and enormous on disk.
const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 1024 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 120_000;

const OWNER = /^[a-z0-9](?:[a-z0-9-]{0,38})$/i;
const NAME = /^[a-z0-9._-]{1,100}$/i;

/**
 * Accepts github.com/owner/name with or without a scheme, `.git` or a trailing
 * slash, or the bare owner/name. Lowercased, because GitHub treats names
 * case-insensitively and one repository must not become two analyses.
 */
export function parseRepositoryUrl(input: string): Repository {
  const trimmed = input.trim().replace(/^https?:\/\//i, "").replace(/^(www\.)?github\.com\//i, "");
  const segments = trimmed.replace(/\/+$/, "").split("/");
  if (segments.length > 2) {
    throw new Error(`"${input}" points inside a repository. Paste the repository's own address, github.com/owner/name.`);
  }
  const [owner = "", rawName = ""] = segments;
  const name = rawName.replace(/\.git$/i, "");
  if (!OWNER.test(owner) || !NAME.test(name) || name === "." || name === "..") {
    throw new Error(`"${input}" isn't a GitHub repository address. Expected github.com/owner/name.`);
  }
  return { owner: owner.toLowerCase(), name: name.toLowerCase() };
}

// codeload serves public archives without an API call, so no token and no
// 60-an-hour rate limit. HEAD is the default branch.
export async function fetchArchive(repository: Repository): Promise<Archive> {
  const label = `${repository.owner}/${repository.name}`;
  const response = await fetch(`https://codeload.github.com/${label}/tar.gz/HEAD`, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (response.status === 404) {
    throw new Error(`GitHub has no public repository at ${label}. It doesn't exist, is private, or has no commits.`);
  }
  if (!response.ok || !response.body) {
    throw new Error(`GitHub answered ${response.status} ${response.statusText} when asked for ${label}.`);
  }
  if (Number(response.headers.get("content-length")) > MAX_ARCHIVE_BYTES) {
    throw new Error(`${label} is larger than ${megabytes(MAX_ARCHIVE_BYTES)} compressed, which is more than one request can parse.`);
  }

  const directory = await mkdtemp(join(tmpdir(), "cartograph-"));
  const remove = () => rm(directory, { recursive: true, force: true });

  let commitSha: string | null = null;
  let received = 0;
  let extracted = 0;
  const source = Readable.from(readBody(response.body));
  try {
    await pipeline(
      source,
      new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          received += chunk.length;
          if (received > MAX_ARCHIVE_BYTES) {
            callback(new Error(`${label} is larger than ${megabytes(MAX_ARCHIVE_BYTES)} compressed, which is more than one request can parse.`));
          } else {
            callback(null, chunk);
          }
        },
      }),
      // tar refuses absolute paths and `..` by default. Only the entry kinds
      // `git archive` produces are written; symlinks are kept so the walk can
      // report them as skipped rather than have them vanish.
      extract({
        cwd: directory,
        strip: 1,
        filter: (_path, entry) => isReadEntry(entry) && ["File", "Directory", "SymbolicLink"].includes(entry.type),
        onReadEntry: (entry) => {
          commitSha ??= entry.globalExtended?.comment ?? null;
          extracted += entry.size;
          if (extracted > MAX_EXTRACTED_BYTES) {
            source.destroy(new Error(`${label} is larger than ${megabytes(MAX_EXTRACTED_BYTES)} unpacked, which is more than one request can parse.`));
          }
        },
      }),
    );
  } catch (error) {
    await remove();
    throw error;
  }

  // `git archive` writes the commit into the archive's global header. Without
  // it there's no honest answer to which commit this map is of.
  if (commitSha === null || !/^[0-9a-f]{40}$/.test(commitSha)) {
    await remove();
    throw new Error(`The archive GitHub sent for ${label} doesn't say which commit it came from.`);
  }
  return { directory, commitSha, remove };
}

// Read through the reader rather than Readable.fromWeb, whose Node stream type
// doesn't accept the DOM ReadableStream that fetch is typed as returning.
async function* readBody(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    // Stops the download too when extraction gives up early.
    await reader.cancel().catch(() => {});
  }
}

function isReadEntry(entry: ReadEntry | object): entry is ReadEntry {
  return "type" in entry && "globalExtended" in entry;
}

function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}
