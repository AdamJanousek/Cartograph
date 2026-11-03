import type { Edge } from "../parser/types.ts";

/**
 * "dependents": what imports the file, and what imports those — everything
 * that may break if it changes (blast radius). "dependencies": what the file
 * imports, and what those import — everything it needs (dependency chain).
 */
export type Direction = "dependents" | "dependencies";

// Two levels is still an answer. Past that the walk returns most of the
// repository, which says nothing about this file in particular.
export const DEFAULT_DEPTH = 2;

export interface Reached {
  path: string;
  /** Steps from the starting file: 1 is a direct neighbour. */
  depth: number;
}

/**
 * Breadth-first from `start` along the edges in one direction, stopping at
 * `depth` steps. Each file appears once, at the shortest distance it's reached.
 * The starting file never appears, even when a cycle leads back to it.
 * Sorted by depth, then path.
 */
export function reach(start: string, edges: readonly Edge[], direction: Direction, depth = DEFAULT_DEPTH): Reached[] {
  const next = new Map<string, string[]>();
  for (const edge of edges) {
    const [from, to] = direction === "dependencies" ? [edge.from, edge.to] : [edge.to, edge.from];
    const list = next.get(from);
    if (list) list.push(to);
    else next.set(from, [to]);
  }

  const seen = new Set([start]);
  const reached: Reached[] = [];
  let frontier = [start];
  for (let level = 1; level <= depth && frontier.length > 0; level++) {
    const found: string[] = [];
    for (const path of frontier) {
      for (const neighbour of next.get(path) ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        found.push(neighbour);
      }
    }
    found.sort();
    for (const path of found) reached.push({ path, depth: level });
    frontier = found;
  }
  return reached;
}
