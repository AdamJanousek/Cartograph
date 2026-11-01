import type { Edge, FileNode } from "../parser/types.ts";

export const ROOT = ".";

/** The most folded nodes the map will show before it raises the threshold. */
export const MAX_NODES = 24;

export interface FoldedNode {
  /** The directory this node stands for, repository-relative. */
  id: string;
  /** Every file inside it, its own and those of directories folded into it, sorted. */
  files: string[];
}

export interface Folding {
  /** The threshold the folding settled on: directories with fewer files merged. */
  threshold: number;
  /** Sorted by id. */
  nodes: FoldedNode[];
  /** File path to the id of the node that holds it. */
  nodeOf: Map<string, string>;
}

/**
 * Every directory starts as its own node. From the deepest directory upward,
 * any holding fewer than `threshold` files merges into its parent. The
 * threshold starts at 2 and rises until the result fits under MAX_NODES; the
 * first that fits wins, so the repository's shape decides the depth.
 */
export function fold(files: readonly FileNode[]): Folding {
  for (let threshold = 2; ; threshold++) {
    const nodes = foldAt(files, threshold);
    // A threshold above the file count folds everything into the root, so the
    // loop always ends.
    if (nodes.size <= MAX_NODES || threshold > files.length) return toFolding(threshold, nodes);
  }
}

function foldAt(files: readonly FileNode[], threshold: number): Map<string, string[]> {
  // Directory -> files currently held. Ancestors with no files of their own are
  // still directories, so they're seeded too.
  const held = new Map<string, string[]>([[ROOT, []]]);
  for (const file of files) {
    for (let dir = file.folder; dir !== ROOT; dir = parentOf(dir)) {
      if (!held.has(dir)) held.set(dir, []);
    }
    held.get(file.folder)!.push(file.path);
  }

  const maxDepth = Math.max(0, ...[...held.keys()].map(depthOf));
  for (let depth = maxDepth; depth > 0; depth--) {
    const atDepth = [...held.keys()].filter((dir) => depthOf(dir) === depth);
    // Decide every merge at this depth before applying any, so siblings
    // can't see each other's merges.
    const merging = atDepth.filter((dir) => held.get(dir)!.length < threshold);
    for (const dir of merging) {
      held.get(parentOf(dir))!.push(...held.get(dir)!);
      held.delete(dir);
    }
  }

  // A directory left with no files (its children all stayed) isn't drawn.
  for (const [dir, paths] of held) if (paths.length === 0) held.delete(dir);
  return held;
}

function toFolding(threshold: number, held: Map<string, string[]>): Folding {
  const nodes = [...held]
    .map(([id, files]) => ({ id, files: [...files].sort() }))
    .sort((a, b) => compare(a.id, b.id));
  const nodeOf = new Map<string, string>();
  for (const node of nodes) for (const file of node.files) nodeOf.set(file, node.id);
  return { threshold, nodes, nodeOf };
}

export interface NodeEdge {
  from: string;
  to: string;
  /** How many file-to-file edges this one stands for. */
  count: number;
}

/**
 * File edges lifted onto whatever holds each end. `endOf` maps a file to the
 * id it's drawn as. Edges between two files drawn as the same thing aren't
 * returned: there's nowhere to draw them.
 */
export function liftEdges(edges: readonly Edge[], endOf: (file: string) => string): NodeEdge[] {
  const byPair = new Map<string, NodeEdge>();
  for (const edge of edges) {
    const from = endOf(edge.from);
    const to = endOf(edge.to);
    if (from === to) continue;
    const key = `${from}\0${to}`;
    const existing = byPair.get(key);
    if (existing) existing.count++;
    else byPair.set(key, { from, to, count: 1 });
  }
  return [...byPair.values()].sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to));
}

export interface GroupFan {
  /** Distinct files outside the group that import something inside it. */
  fanIn: number;
  /** Distinct files outside the group that something inside it imports. */
  fanOut: number;
}

/** Fan-in and fan-out of a set of files taken as one thing. */
export function groupFan(members: ReadonlySet<string>, edges: readonly Edge[]): GroupFan {
  const importers = new Set<string>();
  const imported = new Set<string>();
  for (const edge of edges) {
    const fromInside = members.has(edge.from);
    const toInside = members.has(edge.to);
    if (toInside && !fromInside) importers.add(edge.from);
    if (fromInside && !toInside) imported.add(edge.to);
  }
  return { fanIn: importers.size, fanOut: imported.size };
}

/**
 * The shortest trailing run of path segments that no other id shares. The
 * root is shown as "/".
 */
export function shortLabels(ids: readonly string[]): Map<string, string> {
  const labels = new Map<string, string>();
  const split = new Map(ids.map((id) => [id, id === ROOT ? [] : id.split("/")]));
  for (const id of ids) {
    const segments = split.get(id)!;
    if (segments.length === 0) {
      labels.set(id, "/");
      continue;
    }
    let take = 1;
    while (take < segments.length) {
      const suffix = segments.slice(-take).join("/");
      const clash = ids.some((other) => other !== id && split.get(other)!.slice(-take).join("/") === suffix);
      if (!clash) break;
      take++;
    }
    labels.set(id, segments.slice(-take).join("/"));
  }
  return labels;
}

/** A file's path relative to the directory a node stands for. */
export function relativeTo(nodeId: string, file: string): string {
  return nodeId === ROOT ? file : file.slice(nodeId.length + 1);
}

function parentOf(dir: string): string {
  const slash = dir.lastIndexOf("/");
  return slash === -1 ? ROOT : dir.slice(0, slash);
}

function depthOf(dir: string): number {
  return dir === ROOT ? 0 : dir.split("/").length;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
