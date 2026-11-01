import dagre, { type EdgeLabel, type GraphLabel, type NodeLabel } from "@dagrejs/dagre";
import type { Edge, FileNode } from "../parser/types.ts";
import { type Folding, groupFan, liftEdges, relativeTo, shortLabels } from "./fold.ts";

// What the canvas draws, derived from the parser's files and edges plus which
// folded nodes are open. Pure: the same inputs always give the same picture.

/** The most file rows an open panel shows before it says how many more. */
export const PANEL_ROWS = 12;

/** Handle id an edge uses when it lands on the "more" line of a panel. */
export const MORE = "more";

// Geometry. Labels are monospace, so width is a character count. Height carries
// fan-in and nothing else, so a long name never reads as an important node.
const CHAR = 7.3;
const PAD_X = 20;
const FOLDED_MIN_HEIGHT = 40;
const FOLDED_HEIGHT_PER_STEP = 10;
export const PANEL_HEADER = 30;
export const PANEL_ROW = 20;
const PANEL_MAX_WIDTH = 380;

export interface Row {
  path: string;
  /** Path relative to the panel's folder. */
  label: string;
  fanIn: number;
  fanOut: number;
}

interface Placed {
  id: string;
  /** Shortest label unique among the folded nodes and panels on screen. */
  label: string;
  fileCount: number;
  fanIn: number;
  fanOut: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FoldedItem extends Placed {
  kind: "folded";
}

export interface PanelItem extends Placed {
  kind: "panel";
  rows: Row[];
  /** Files in the folder beyond the rows shown. */
  more: number;
}

export type MapItem = FoldedItem | PanelItem;

export interface MapEdge {
  id: string;
  source: string;
  target: string;
  /** Row path or MORE when the end is inside an open panel; null for a folded node. */
  sourceHandle: string | null;
  targetHandle: string | null;
  /** File-to-file edges this one stands for. */
  count: number;
}

export interface MapModel {
  items: MapItem[];
  edges: MapEdge[];
}

export function buildMap(
  files: readonly FileNode[],
  edges: readonly Edge[],
  folding: Folding,
  open: ReadonlySet<string>,
): MapModel {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const labels = shortLabels(folding.nodes.map((node) => node.id));

  const unplaced: (Omit<FoldedItem, "x" | "y"> | Omit<PanelItem, "x" | "y">)[] = [];
  // File path -> the row it's drawn as, for files inside an open panel.
  const handleOf = new Map<string, string>();

  for (const node of folding.nodes) {
    const fan = groupFan(new Set(node.files), edges);
    const label = labels.get(node.id)!;
    const meta = `${node.files.length} files`;
    const base = { id: node.id, label, fileCount: node.files.length, fanIn: fan.fanIn, fanOut: fan.fanOut };

    if (!open.has(node.id)) {
      unplaced.push({
        ...base,
        kind: "folded",
        width: textWidth(Math.max(label.length, meta.length)),
        height: FOLDED_MIN_HEIGHT + FOLDED_HEIGHT_PER_STEP * Math.log2(1 + fan.fanIn),
      });
      continue;
    }

    // Most depended-on first, so the rows that fit are the ones that matter most.
    const sorted = node.files
      .map((path) => byPath.get(path)!)
      .sort((a, b) => b.fanIn - a.fanIn || (a.path < b.path ? -1 : 1));
    const rows = sorted.slice(0, PANEL_ROWS).map((file) => ({
      path: file.path,
      label: relativeTo(node.id, file.path),
      fanIn: file.fanIn,
      fanOut: file.fanOut,
    }));
    const more = sorted.length - rows.length;
    for (const file of sorted) handleOf.set(file.path, MORE);
    for (const row of rows) handleOf.set(row.path, row.path);

    const header = `${label}  ${meta}  in ${fan.fanIn}  out ${fan.fanOut}`;
    const widest = Math.max(header.length, ...rows.map((row) => row.label.length + 10));
    unplaced.push({
      ...base,
      kind: "panel",
      rows,
      more,
      width: Math.min(PANEL_MAX_WIDTH, textWidth(widest)),
      height: PANEL_HEADER + PANEL_ROW * (rows.length + (more > 0 ? 1 : 0)) + 4,
    });
  }

  // Each file end becomes "node\0handle"; lifting merges every file edge that
  // lands on the same pair of ends.
  const endOf = (path: string) => {
    const node = folding.nodeOf.get(path)!;
    return `${node}\0${handleOf.get(path) ?? ""}`;
  };
  const lifted = liftEdges(edges, endOf).map((edge) => {
    const [source, sourceHandle] = edge.from.split("\0");
    const [target, targetHandle] = edge.to.split("\0");
    return {
      id: `${edge.from}->${edge.to}`,
      source,
      target,
      sourceHandle: sourceHandle || null,
      targetHandle: targetHandle || null,
      count: edge.count,
    };
  });
  // Rows in the same panel are inside one box; there's nowhere to draw between them.
  const mapEdges = lifted.filter((edge) => edge.source !== edge.target);

  return { items: layout(unplaced, mapEdges), edges: mapEdges };
}

function layout(
  unplaced: (Omit<FoldedItem, "x" | "y"> | Omit<PanelItem, "x" | "y">)[],
  edges: readonly MapEdge[],
): MapItem[] {
  const graph = new dagre.graphlib.Graph<GraphLabel, NodeLabel, EdgeLabel>();
  graph.setGraph({ rankdir: "LR", nodesep: 14, ranksep: 60, marginx: 10, marginy: 10 });
  graph.setDefaultEdgeLabel(() => ({}));
  // Insertion order is sorted upstream, which is what makes dagre's output stable.
  for (const item of unplaced) graph.setNode(item.id, { width: item.width, height: item.height });
  for (const [source, target] of skeleton(edges)) graph.setEdge(source, target);
  dagre.layout(graph);

  return unplaced.map((item) => {
    const { x, y } = graph.node(item.id);
    if (x === undefined || y === undefined) throw new Error(`dagre placed no position for ${item.id}`);
    // dagre positions by centre; the canvas by top-left corner.
    return { ...item, x: x - item.width / 2, y: y - item.height / 2 };
  });
}

/**
 * The edges dagre ranks by. Folders depend on each other in cycles, and fed
 * every edge dagre strings them into one long chain with the back edges piled
 * up beside it. So it gets each node's strongest outgoing link instead —
 * the weaker side of a two-way pair dropped — and every edge is still drawn.
 */
function skeleton(edges: readonly MapEdge[]): [string, string][] {
  const weight = new Map<string, number>();
  for (const edge of edges) {
    const key = `${edge.source}\0${edge.target}`;
    weight.set(key, (weight.get(key) ?? 0) + edge.count);
  }
  const outgoing = new Map<string, { target: string; weight: number }[]>();
  for (const [key, w] of weight) {
    const [source, target] = key.split("\0");
    const back = weight.get(`${target}\0${source}`) ?? 0;
    if (back > w || (back === w && source > target)) continue;
    outgoing.set(source, [...(outgoing.get(source) ?? []), { target, weight: w }]);
  }
  const links: [string, string][] = [];
  for (const source of [...outgoing.keys()].sort()) {
    const [strongest] = outgoing
      .get(source)!
      .sort((a, b) => b.weight - a.weight || (a.target < b.target ? -1 : 1));
    links.push([source, strongest.target]);
  }
  return links;
}

function textWidth(chars: number): number {
  return Math.ceil(chars * CHAR + PAD_X);
}
