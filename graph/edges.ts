import type { Edge, EdgeKind } from "../parser/types.ts";

export interface EdgeInput {
  from: string;
  to: string;
  kind: EdgeKind;
  typeOnly: boolean;
}

/** Collapses every import between the same two files into one edge. */
export function dedupeEdges(inputs: readonly EdgeInput[]): Edge[] {
  const byPair = new Map<string, { from: string; to: string; kinds: Set<EdgeKind>; typeOnly: boolean }>();
  for (const input of inputs) {
    const key = `${input.from}\0${input.to}`;
    const existing = byPair.get(key);
    if (existing) {
      existing.kinds.add(input.kind);
      existing.typeOnly &&= input.typeOnly;
    } else {
      byPair.set(key, { from: input.from, to: input.to, kinds: new Set([input.kind]), typeOnly: input.typeOnly });
    }
  }
  return [...byPair.values()]
    .map((edge) => ({ from: edge.from, to: edge.to, kinds: [...edge.kinds].sort(), typeOnly: edge.typeOnly }))
    .sort((a, b) => (a.from === b.from ? compare(a.to, b.to) : compare(a.from, b.from)));
}

export interface Fan {
  fanIn: number;
  fanOut: number;
}

/** Distinct importers and distinct imports per file. Expects deduplicated edges. */
export function computeFan(paths: readonly string[], edges: readonly Edge[]): Map<string, Fan> {
  const fan = new Map<string, Fan>(paths.map((path) => [path, { fanIn: 0, fanOut: 0 }]));
  for (const edge of edges) {
    const from = fan.get(edge.from);
    const to = fan.get(edge.to);
    if (from) from.fanOut += 1;
    if (to) to.fanIn += 1;
  }
  return fan;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
