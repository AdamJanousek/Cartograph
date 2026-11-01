import type { FileNode } from "../parser/types.ts";

export interface Category {
  /** The adapter's role, or null for files nothing has labelled. */
  role: string | null;
  count: number;
}

/**
 * Files grouped by the role the adapter gave them. Files with no role stay one
 * unlabelled group rather than being sorted by extension or folder — that
 * would be a category nobody actually determined. Largest first, ties by name,
 * unlabelled last.
 */
export function categorize(files: readonly FileNode[]): Category[] {
  const counts = new Map<string | null, number>();
  for (const file of files) counts.set(file.role, (counts.get(file.role) ?? 0) + 1);
  return [...counts]
    .map(([role, count]) => ({ role, count }))
    .sort((a, b) => {
      if (a.role === null) return 1;
      if (b.role === null) return -1;
      return b.count - a.count || (a.role < b.role ? -1 : 1);
    });
}
