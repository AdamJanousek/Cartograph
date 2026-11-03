import dagre, { type EdgeLabel, type GraphLabel, type NodeLabel } from "@dagrejs/dagre";
import type { Edge, FileNode } from "../parser/types.ts";
import { type Folding, groupFan, liftEdges, shortLabels } from "./fold.ts";

// What the canvas draws, derived from the parser's files and edges plus which
// folded nodes are open and how far each open panel is scrolled. Pure: the
// same inputs always give the same picture.

/** Rows an open panel shows at once; the rest scroll, and the panel never grows past this. */
export const PANEL_ROWS = 12;

/** Handle ids for edges whose file is scrolled out of view: above the visible rows, or below them. */
export const ABOVE = "above";
export const BELOW = "below";

// Geometry. Labels are monospace, so width is a character count. Height carries
// fan-in and nothing else, so a long name never reads as an important node.
const CHAR = 7.3;
const PAD_X = 20;
const FOLDED_MIN_HEIGHT = 56;
const FOLDED_HEIGHT_PER_STEP = 8;
// Two lines: the folder's name, then its file count and fans.
export const PANEL_HEADER = 40;
export const PANEL_ROW = 20;
const PANEL_MAX_WIDTH = 380;
// Room for the counts beside a label. Fixed, so only the label moves the width:
// a big count must not make a box look more important.
// Folded nodes put the count and the fans on lines of their own. The count
// line is sized for its longest form, a rail category's matches.
const FOLDED_META_CHARS = "■ 999 of 999".length;
const PANEL_META_CHARS = "■ 999 of 999  ←999 999→".length;
const PANEL_ROW_META_CHARS = "■  ←999 999→ ".length;

export interface Row {
  path: string;
  /** Shortest trailing part of the path unique among everything on screen. */
  label: string;
  fanIn: number;
  fanOut: number;
}

interface Placed {
  id: string;
  /** Shortest label unique among everything on screen. */
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
  /** Every file in the folder, most depended-on first. */
  rows: Row[];
  /** Index of the first visible row. Rows [offset, offset + PANEL_ROWS) are in view. */
  offset: number;
  /** Rows scrolled out of view above and below. */
  above: number;
  below: number;
}

export type MapItem = FoldedItem | PanelItem;

export interface MapEdge {
  id: string;
  source: string;
  target: string;
  /** Row path, ABOVE or BELOW when the end is inside an open panel; null for a folded node. */
  sourceHandle: string | null;
  targetHandle: string | null;
  /** File-to-file edges this one stands for. */
  count: number;
}

export interface MapModel {
  items: MapItem[];
  edges: MapEdge[];
  /** File path to the handle it's drawn at, for every file inside an open panel. */
  handleOf: ReadonlyMap<string, string>;
}

export function buildMap(
  files: readonly FileNode[],
  edges: readonly Edge[],
  folding: Folding,
  open: ReadonlySet<string>,
  /** First visible row per open panel; missing means the top. */
  scroll: ReadonlyMap<string, number>,
): MapModel {
  const byPath = new Map(files.map((file) => [file.path, file]));

  // Rows first: labels have to be unique among everything on screen, rows
  // included, so they can't be chosen until every row is known. Every row of
  // an open panel counts, scrolled or not, so a label doesn't change as you
  // scroll past another.
  const rowsOf = new Map<string, FileNode[]>();
  for (const node of folding.nodes) {
    if (!open.has(node.id)) continue;
    rowsOf.set(node.id, panelOrder(node.files, byPath));
  }
  const onScreen = [
    ...folding.nodes.map((node) => node.id),
    ...[...rowsOf.values()].flatMap((rows) => rows.map((row) => row.path)),
  ];
  const labels = shortLabels(onScreen);

  const unplaced: (Omit<FoldedItem, "x" | "y"> | Omit<PanelItem, "x" | "y">)[] = [];
  // File path -> the row it's drawn as, for files inside an open panel.
  const handleOf = new Map<string, string>();

  for (const node of folding.nodes) {
    const fan = groupFan(new Set(node.files), edges);
    const label = labels.get(node.id)!;
    const base = { id: node.id, label, fileCount: node.files.length, fanIn: fan.fanIn, fanOut: fan.fanOut };
    const panel = rowsOf.get(node.id);

    if (!panel) {
      unplaced.push({
        ...base,
        kind: "folded",
        width: textWidth(Math.max(label.length, FOLDED_META_CHARS)),
        height: FOLDED_MIN_HEIGHT + FOLDED_HEIGHT_PER_STEP * Math.log2(1 + fan.fanIn),
      });
      continue;
    }

    const rows = panel.map((file) => ({
      path: file.path,
      label: labels.get(file.path)!,
      fanIn: file.fanIn,
      fanOut: file.fanOut,
    }));
    const visible = Math.min(rows.length, PANEL_ROWS);
    const offset = Math.min(Math.max(0, scroll.get(node.id) ?? 0), rows.length - visible);
    rows.forEach((row, index) =>
      handleOf.set(row.path, index < offset ? ABOVE : index >= offset + visible ? BELOW : row.path),
    );

    const widest = Math.max(
      label.length,
      PANEL_META_CHARS,
      ...rows.map((row) => row.label.length + PANEL_ROW_META_CHARS),
    );
    unplaced.push({
      ...base,
      kind: "panel",
      rows,
      offset,
      above: offset,
      below: rows.length - offset - visible,
      width: Math.min(PANEL_MAX_WIDTH, textWidth(widest)),
      // Fixed whatever the scroll, so scrolling never moves anything else.
      height: panelHeight(rows.length),
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

  return { items: layout(unplaced, mapEdges), edges: mapEdges, handleOf };
}

/**
 * An open panel's rows in the order they're listed. Most depended-on first, so
 * the rows in view when it opens are the ones that matter most.
 */
export function panelOrder(paths: readonly string[], byPath: ReadonlyMap<string, FileNode>): FileNode[] {
  return paths.map((path) => byPath.get(path)!).sort((a, b) => b.fanIn - a.fanIn || (a.path < b.path ? -1 : 1));
}

/** Header, the rows in view, and a footer line counting what's scrolled out when anything can be. */
export function panelHeight(rowCount: number): number {
  const scrolls = rowCount > PANEL_ROWS;
  return PANEL_HEADER + PANEL_ROW * (Math.min(rowCount, PANEL_ROWS) + (scrolls ? 1 : 0)) + 4;
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
