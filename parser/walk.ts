import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import type { ExcludedDirectory, SkippedFile } from "./types.ts";

export const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

// Directories that hold other people's code or generated output, by
// convention common to every JS toolchain. Framework-specific output
// directories are either hidden (".next", ".svelte-kit") or an adapter's job.
const DEPENDENCY_DIRS = new Set(["node_modules", "bower_components"]);
const BUILD_OUTPUT_DIRS = new Set(["dist", "build", "out", "coverage"]);

const MAX_BYTES = 1_000_000;
// Hand-written code averages well under 100 characters a line. A file that
// averages this many is a bundle or generated blob, and parsing it would
// produce edges nobody wrote.
const MINIFIED_AVERAGE_LINE = 500;

export interface WalkedFile {
  path: string;
  absolutePath: string;
  folder: string;
  text: string;
  lines: number;
  bytes: number;
  hash: string;
}

export interface WalkResult {
  files: WalkedFile[];
  skips: SkippedFile[];
  excludedDirectories: ExcludedDirectory[];
  /** Repository-relative paths of every package.json seen. */
  packageJsonPaths: string[];
}

export function isSourcePath(path: string): boolean {
  return SOURCE_EXTENSIONS.some((ext) => path.endsWith(ext));
}

export function folderOf(path: string): string {
  return posix.dirname(path);
}

// Selection is structural: every source file in every directory the walk
// enters is kept. No file is dropped for being large in a way that would leave
// its importers pointing at nothing — a skip is recorded and imports of it are
// reported as landing on a skipped file.
export function walkRepository(root: string): WalkResult {
  const result: WalkResult = { files: [], skips: [], excludedDirectories: [], packageJsonPaths: [] };
  visit(root, "", result);
  result.files.sort((a, b) => compare(a.path, b.path));
  result.skips.sort((a, b) => compare(a.path, b.path));
  result.excludedDirectories.sort((a, b) => compare(a.path, b.path));
  result.packageJsonPaths.sort(compare);
  return result;
}

function visit(root: string, relativeDir: string, result: WalkResult): void {
  const entries = readdirSync(join(root, relativeDir), { withFileTypes: true });
  for (const entry of entries) {
    const path = relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;
    const absolutePath = join(root, path);

    if (entry.isSymbolicLink()) {
      // Following links could leave the repository or loop; say so instead.
      const isDirectory = safeIsDirectory(absolutePath);
      if (isDirectory) result.excludedDirectories.push({ path, reason: "symlink" });
      else if (isSourcePath(path)) result.skips.push({ path, reason: "symlink", detail: "symbolic link not followed" });
      continue;
    }

    if (entry.isDirectory()) {
      const reason = excludedReason(entry.name);
      if (reason) result.excludedDirectories.push({ path, reason });
      else visit(root, path, result);
      continue;
    }

    if (!entry.isFile()) continue;
    if (entry.name === "package.json") result.packageJsonPaths.push(path);
    if (!isSourcePath(path)) continue;

    const read = readSource(path, absolutePath);
    if ("reason" in read) result.skips.push(read);
    else result.files.push(read);
  }
}

function excludedReason(name: string): ExcludedDirectory["reason"] | null {
  if (DEPENDENCY_DIRS.has(name)) return "dependencies";
  if (name.startsWith(".")) return "hidden";
  if (BUILD_OUTPUT_DIRS.has(name)) return "build-output";
  return null;
}

function readSource(path: string, absolutePath: string): WalkedFile | SkippedFile {
  let buffer: Buffer;
  try {
    buffer = readFileSync(absolutePath);
  } catch (error) {
    return { path, reason: "read-error", detail: errorMessage(error) };
  }

  if (buffer.byteLength > MAX_BYTES) {
    return { path, reason: "too-large", detail: `${buffer.byteLength} bytes, limit is ${MAX_BYTES}` };
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return { path, reason: "not-utf8", detail: "contents are not valid UTF-8" };
  }

  const lines = countLines(text);
  const average = lines === 0 ? 0 : Math.round(buffer.byteLength / lines);
  if (average > MINIFIED_AVERAGE_LINE) {
    return { path, reason: "minified", detail: `${average} characters per line on average across ${lines} lines` };
  }

  return {
    path,
    absolutePath,
    folder: folderOf(path),
    text,
    lines,
    bytes: buffer.byteLength,
    hash: createHash("sha256").update(buffer).digest("hex"),
  };
}

/** Lines as an editor shows them; a trailing newline doesn't start a new one. */
export function countLines(text: string): number {
  if (text.length === 0) return 0;
  const breaks = text.match(/\r\n|\r|\n/g)?.length ?? 0;
  return /(\r\n|\r|\n)$/.test(text) ? breaks : breaks + 1;
}

// A dangling link counts as a file.
function safeIsDirectory(absolutePath: string): boolean {
  try {
    return statSync(absolutePath).isDirectory();
  } catch {
    return false;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
