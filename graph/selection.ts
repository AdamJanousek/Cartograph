import type { Edge } from "../parser/types.ts";
import type { MapModel } from "./map.ts";

/** A folded node or open panel by id, or one file row inside an open panel. */
export type Selection = { kind: "node"; id: string } | { kind: "row"; node: string; path: string };

/**
 * How something relates to the selection. "imported": the selection imports
 * it. "importer": it imports the selection. "both": each imports the other.
 */
export type Relation = "imported" | "importer" | "both";

export interface Highlight {
  /** Nodes and panels that stay at full strength. */
  nodes: Set<string>;
  /** Rows that stay at full strength, keyed by `rowKey`. A panel kept only for its rows dims the rest. */
  rows: Set<string>;
  /** Panels kept whole: the selection itself, or something whose edge lands on the panel's own box. */
  wholePanels: Set<string>;
  /** Edges touching the selection, by what the far end is to it. Never "both": an edge has one direction. */
  edges: Map<string, Exclude<Relation, "both">>;
  /** What each kept end is to the selection, keyed by `endKey`. The selection itself has none. */
  relations: Map<string, Relation>;
}

/** Key for `relations`: a row, a panel's above/below line, or (handle null) a whole folded node. */
export function endKey(node: string, handle: string | null): string {
  return rowKey(node, handle ?? "");
}

export function rowKey(node: string, handle: string): string {
  return `${node}\0${handle}`;
}

/**
 * What stays at full strength: the selection, every edge touching it, and
 * whatever is at the other end of those edges. Null when the selection isn't
 * on screen, which means nothing is dimmed.
 *
 * A selected row's far ends come from the file edges, not the drawn ones.
 * Two of its connections have no edge of their own: a file in the same panel
 * (nowhere to draw it), and anything while the row is scrolled out of view
 * (its edges land on the panel's above/below line, shared with other files).
 * Either way the file at the other end is still connected and stays bright.
 */
export function highlight(
  model: MapModel,
  selection: Selection | null,
  files: readonly Edge[],
  nodeOf: ReadonlyMap<string, string>,
): Highlight | null {
  if (!selection || !present(model, selection)) return null;

  const result: Highlight = {
    nodes: new Set(),
    rows: new Set(),
    wholePanels: new Set(),
    edges: new Map(),
    relations: new Map(),
  };
  const keep = (node: string, handle: string | null) => {
    result.nodes.add(node);
    if (handle === null) result.wholePanels.add(node);
    else result.rows.add(rowKey(node, handle));
  };
  const relate = (node: string, handle: string | null, relation: Exclude<Relation, "both">) => {
    keep(node, handle);
    const key = endKey(node, handle);
    const existing = result.relations.get(key);
    result.relations.set(key, existing && existing !== relation ? "both" : relation);
  };

  if (selection.kind === "node") keep(selection.id, null);
  else keep(selection.node, selection.path);

  if (selection.kind === "node") {
    // An edge runs from the importing file to the imported one.
    for (const edge of model.edges) {
      if (edge.source === selection.id) {
        result.edges.set(edge.id, "imported");
        relate(edge.target, edge.targetHandle, "imported");
      } else if (edge.target === selection.id) {
        result.edges.set(edge.id, "importer");
        relate(edge.source, edge.sourceHandle, "importer");
      }
    }
    return result;
  }

  // Only edges drawn from the row itself are coloured: one landing on an
  // above/below line carries other files' imports too.
  for (const edge of model.edges) {
    if (edge.source === selection.node && edge.sourceHandle === selection.path) result.edges.set(edge.id, "imported");
    else if (edge.target === selection.node && edge.targetHandle === selection.path) result.edges.set(edge.id, "importer");
  }
  for (const edge of files) {
    const relation = edge.from === selection.path ? "imported" : edge.to === selection.path ? "importer" : null;
    if (relation === null) continue;
    const other = relation === "imported" ? edge.to : edge.from;
    relate(nodeOf.get(other)!, model.handleOf.get(other) ?? null, relation);
  }
  return result;
}

function present(model: MapModel, selection: Selection): boolean {
  if (selection.kind === "node") return model.items.some((item) => item.id === selection.id);
  return model.items.some(
    (item) =>
      item.id === selection.node && item.kind === "panel" && item.rows.some((row) => row.path === selection.path),
  );
}
