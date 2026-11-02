import type { FileNode } from "../parser/types.ts";

/**
 * File types the rail can show, longest suffix first so ".d.ts" wins over
 * ".ts". These are the parser's source extensions plus declaration files; a
 * path matching none of them would be a parser change, and shows as "other".
 */
const TYPES = [".d.ts", ".tsx", ".ts", ".mts", ".cts", ".jsx", ".js", ".mjs", ".cjs"] as const;

export type FileType = (typeof TYPES)[number] | "other";

export interface Category {
  type: FileType;
  count: number;
}

/** A file's type, read off the end of its path. */
export function fileType(path: string): FileType {
  return TYPES.find((type) => path.endsWith(type)) ?? "other";
}

/** Files grouped by type. Largest first, ties by name. */
export function categorize(files: readonly FileNode[]): Category[] {
  const counts = new Map<FileType, number>();
  for (const file of files) {
    const type = fileType(file.path);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || (a.type < b.type ? -1 : 1));
}
