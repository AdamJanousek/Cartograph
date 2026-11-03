import type { Edge, FileNode } from "../parser/types.ts";

// Four facts about the edge list, worded by fixed sentences. Nothing here
// judges a file; each list is something the graph plainly shows.

export type InsightKind = "unimported" | "hubs" | "cycles" | "long";

/** The order the panel shows them in. Unimported leads: it explains where reading starts. */
export const INSIGHT_KINDS: readonly InsightKind[] = ["unimported", "hubs", "cycles", "long"];

/** Over this many lines counts as long. */
export const LONG_LINES = 1000;

// Above the 99th percentile of fan-in is unusual, but in a small repository
// that can be three importers, which isn't. Below the floor nothing qualifies.
const HUB_PERCENTILE = 0.99;
const HUB_FLOOR = 10;

export const INSIGHT_SENTENCE: Record<InsightKind, string> = {
  unimported: "Nothing in the repository imports these files, and no framework convention reaches them.",
  hubs: "An unusual number of files import each of these.",
  cycles: "Each file in a loop imports the next, and the last imports the first.",
  long: `Each of these files is over ${LONG_LINES.toLocaleString("en")} lines.`,
};

export interface CountedFile {
  path: string;
  /** Importers for a hub, lines for a long file, files imported for an unimported one. */
  count: number;
}

export interface LoopStep {
  path: string;
  /** Every import from this file to the next one in the loop is type-only. */
  typeOnly: boolean;
}

export interface Cycle {
  /** The shortest loop in its group: each step imports the next, the last imports the first. */
  loop: LoopStep[];
  /** How many files in all can reach each other through loops, this one included. */
  group: number;
}

export interface Insights {
  unimported: CountedFile[];
  hubs: CountedFile[];
  cycles: Cycle[];
  long: CountedFile[];
  /** The fan-in a file has to exceed to be a hub. */
  hubThreshold: number;
}

export function findInsights(files: readonly FileNode[], edges: readonly Edge[]): Insights {
  const hubThreshold = Math.max(HUB_FLOOR - 1, percentile(files.map((file) => file.fanIn), HUB_PERCENTILE));
  return {
    // A file with a role is reached by its framework or toolchain — a page, a
    // config, a test — so the import graph not reaching it says nothing.
    unimported: counted(files.filter((file) => file.fanIn === 0 && file.role === null), (file) => file.fanOut),
    hubs: counted(files.filter((file) => file.fanIn > hubThreshold), (file) => file.fanIn),
    cycles: findCycles(files, edges),
    long: counted(files.filter((file) => file.lines > LONG_LINES), (file) => file.lines),
    hubThreshold,
  };
}

function counted(files: readonly FileNode[], by: (file: FileNode) => number): CountedFile[] {
  return files
    .map((file) => ({ path: file.path, count: by(file) }))
    .sort((a, b) => b.count - a.count || (a.path < b.path ? -1 : 1));
}

/** Nearest-rank percentile. 0 for an empty list. */
function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

/**
 * One cycle per group of files that reach each other (a strongly connected
 * component), shown as the shortest loop inside it. Listing every loop isn't
 * possible: a group of a few dozen files can hold millions. Shortest loops
 * first, since those are the ones a person can walk by hand.
 */
export function findCycles(files: readonly FileNode[], edges: readonly Edge[]): Cycle[] {
  const out = new Map<string, string[]>();
  const typeOnly = new Map<string, boolean>();
  for (const file of files) out.set(file.path, []);
  for (const edge of edges) {
    out.get(edge.from)?.push(edge.to);
    typeOnly.set(`${edge.from}\0${edge.to}`, edge.typeOnly);
  }
  for (const list of out.values()) list.sort();

  const cycles: Cycle[] = [];
  for (const group of components(out)) {
    const members = new Set(group);
    const selfLoop = group.length === 1 && out.get(group[0])!.includes(group[0]);
    if (group.length === 1 && !selfLoop) continue;

    let best: string[] | null = null;
    for (const start of group) {
      const loop = shortestLoop(start, out, members, best?.length ?? Infinity);
      if (loop && (!best || loop.length < best.length)) best = loop;
    }
    const loop = best!;
    cycles.push({
      loop: loop.map((path, index) => ({
        path,
        typeOnly: typeOnly.get(`${path}\0${loop[(index + 1) % loop.length]}`) ?? false,
      })),
      group: group.length,
    });
  }
  return cycles.sort(
    (a, b) => a.loop.length - b.loop.length || b.group - a.group || (a.loop[0].path < b.loop[0].path ? -1 : 1),
  );
}

/**
 * Tarjan's strongly connected components, iteratively: a real repository's
 * import chains are deep enough to overflow the call stack if this recursed.
 * Each component comes back sorted by path.
 */
function components(out: ReadonlyMap<string, readonly string[]>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];
  let counter = 0;

  for (const root of [...out.keys()].sort()) {
    if (index.has(root)) continue;
    // Each frame is a file and how far through its imports the walk has got.
    const frames: { path: string; next: number }[] = [{ path: root, next: 0 }];
    index.set(root, counter);
    low.set(root, counter);
    counter++;
    stack.push(root);
    onStack.add(root);

    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const targets = out.get(frame.path)!;
      if (frame.next < targets.length) {
        const target = targets[frame.next++];
        if (!index.has(target)) {
          index.set(target, counter);
          low.set(target, counter);
          counter++;
          stack.push(target);
          onStack.add(target);
          frames.push({ path: target, next: 0 });
        } else if (onStack.has(target)) {
          low.set(frame.path, Math.min(low.get(frame.path)!, index.get(target)!));
        }
        continue;
      }

      frames.pop();
      const parent = frames[frames.length - 1];
      if (parent) low.set(parent.path, Math.min(low.get(parent.path)!, low.get(frame.path)!));
      if (low.get(frame.path) === index.get(frame.path)) {
        const component: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.path);
        result.push(component.sort());
      }
    }
  }
  return result;
}

/**
 * The shortest loop from `start` back to itself, staying inside `members`.
 * Breadth-first, so the first way back found is a shortest one. Gives up once
 * loops would be no shorter than `limit`.
 */
function shortestLoop(
  start: string,
  out: ReadonlyMap<string, readonly string[]>,
  members: ReadonlySet<string>,
  limit: number,
): string[] | null {
  const parent = new Map<string, string>();
  let frontier = [start];
  for (let length = 1; length < limit && frontier.length > 0; length++) {
    const next: string[] = [];
    for (const path of frontier) {
      for (const target of out.get(path)!) {
        if (target === start) {
          const loop = [path];
          while (loop[0] !== start) loop.unshift(parent.get(loop[0])!);
          return loop;
        }
        if (!members.has(target) || parent.has(target)) continue;
        parent.set(target, path);
        next.push(target);
      }
    }
    frontier = next;
  }
  return null;
}
