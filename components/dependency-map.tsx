"use client";

import "@xyflow/react/dist/base.css";
import {
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useUpdateNodeInternals,
} from "@xyflow/react";
import { type CSSProperties, useEffect, useMemo, useRef } from "react";
import { pathColour, typeColour } from "@/components/file-type";
import { useMapState } from "@/components/map-state";
import {
  buildMap,
  type FoldedItem,
  ABOVE,
  BELOW,
  PANEL_HEADER,
  PANEL_ROW,
  PANEL_ROWS,
  type PanelItem,
} from "@/graph/map";
import { type FileType, fileType } from "@/graph/categories";
import { endKey, highlight, type Relation, rowKey } from "@/graph/selection";

type FoldedNodeData = {
  item: FoldedItem;
  dimmed: boolean;
  selected: boolean;
  relation: Relation | null;
  /** Pointed at from the detail pane. */
  marked: boolean;
  /** Files of the rail's category inside; null when no category is picked. */
  matches: Match | null;
};
type PanelNodeData = {
  item: PanelItem;
  dimmed: boolean;
  selected: boolean;
  /** Row handles kept at full strength; null when every row is. */
  keptRows: ReadonlySet<string> | null;
  selectedRow: string | null;
  /** What each row (by handle) is to the selection, for rows that are anything to it. */
  relations: ReadonlyMap<string, Relation>;
  /** The whole panel is pointed at from the detail pane. */
  marked: boolean;
  /** The row, or above/below line, pointed at from the detail pane. */
  markedHandle: string | null;
  matches: Match | null;
  /** Rows, and above/below lines, holding no file of the rail's category. Empty when none is picked. */
  outside: ReadonlySet<string>;
};
type Match = { type: FileType; count: number };
type MapNode = Node<FoldedNodeData, "folded"> | Node<PanelNodeData, "panel">;

const DIM = 0.25;
const NODE_Z = 10;
const DIM_EDGE = 0.12;

// Outside the border, so it reads as "this one" without being mistaken for
// the selection's border.
const MARK: CSSProperties = { outline: "2px solid var(--accent)", outlineOffset: 2 };
const MARK_ROW: CSSProperties = { outline: "1px solid var(--accent)", outlineOffset: -1 };

export function DependencyMap() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}

function Canvas() {
  const { files, edges, folding, open, scroll, selection, hover, opened, category, setSelection, setHover, openFolder } =
    useMapState();
  const { fitView, getZoom } = useReactFlow();

  const model = useMemo(
    () => buildMap(files, edges, folding, open, scroll),
    [files, edges, folding, open, scroll],
  );
  const lit = useMemo(
    () => highlight(model, selection, edges, folding.nodeOf),
    [model, selection, edges, folding],
  );
  // Where a hover lands on the map: a whole node, or a handle inside an open
  // panel — the file's row, or the above/below line while it's scrolled out.
  const mark = useMemo(() => {
    if (!hover) return null;
    if (hover.kind === "node") return { node: hover.id, handle: null };
    const node = folding.nodeOf.get(hover.path);
    return node === undefined ? null : { node, handle: model.handleOf.get(hover.path) ?? null };
  }, [hover, folding, model]);

  // The rail's category: how many of each node's files are of it, and which
  // ends on screen hold none. Every file sits in exactly one node, so the
  // counts add up to the rail's.
  const filter = useMemo(() => {
    if (category === null) return null;
    const matches = new Map(
      folding.nodes.map((node) => [node.id, node.files.filter((path) => fileType(path) === category).length]),
    );
    const outside = new Map<string, Set<string>>();
    for (const item of model.items) {
      if (item.kind !== "panel") continue;
      const visible = Math.min(item.rows.length, PANEL_ROWS);
      const some = (rows: typeof item.rows) => rows.some((row) => fileType(row.path) === category);
      const set = new Set(item.rows.filter((row) => fileType(row.path) !== category).map((row) => row.path));
      if (!some(item.rows.slice(0, item.offset))) set.add(ABOVE);
      if (!some(item.rows.slice(item.offset + visible))) set.add(BELOW);
      outside.set(item.id, set);
    }
    return { type: category, matches, outside } satisfies Filter;
  }, [category, folding, model]);

  const nodes = useMemo<MapNode[]>(
    () =>
      model.items.map((item) => {
        const common = {
          id: item.id,
          position: { x: item.x, y: item.y },
          width: item.width,
          height: item.height,
          // Above every edge, highlighted ones included: lines pass under a
          // box, never across its rows.
          zIndex: NODE_Z,
        };
        const matches = filter && { type: filter.type, count: filter.matches.get(item.id) ?? 0 };
        const dimmed = (lit !== null && !lit.nodes.has(item.id)) || matches?.count === 0;
        const selected = selection?.kind === "node" && selection.id === item.id;
        const marked = mark?.node === item.id && mark.handle === null;
        if (item.kind === "folded") {
          const relation = lit?.relations.get(endKey(item.id, null)) ?? null;
          return { ...common, type: "folded", data: { item, dimmed, selected, relation, marked, matches } };
        }
        const whole = lit === null || lit.wholePanels.has(item.id);
        const keptRows = whole
          ? null
          : new Set(
              [...item.rows.map((row) => row.path), ABOVE, BELOW].filter((handle) =>
                lit.rows.has(rowKey(item.id, handle)),
              ),
            );
        const selectedRow = selection?.kind === "row" && selection.node === item.id ? selection.path : null;
        const relations = new Map<string, Relation>();
        for (const handle of [...item.rows.map((row) => row.path), ABOVE, BELOW]) {
          const relation = lit?.relations.get(endKey(item.id, handle));
          if (relation) relations.set(handle, relation);
        }
        const markedHandle = mark?.node === item.id ? mark.handle : null;
        return {
          ...common,
          type: "panel",
          data: {
            item,
            dimmed,
            selected,
            keptRows,
            selectedRow,
            relations,
            marked,
            markedHandle,
            matches,
            outside: filter?.outside.get(item.id) ?? NONE,
          },
        };
      }),
    [model, lit, selection, mark, filter],
  );

  const flowEdges = useMemo(
    () =>
      model.edges.map((edge) => {
        const direction = lit?.edges.get(edge.id);
        // Direction is the one thing edge colour means, and the far end wears
        // the same colour: green for what imports the selection, yellow for
        // what the selection imports.
        // With a category picked, an edge stays only between ends that hold some of it.
        const away =
          filteredOut(filter, edge.source, edge.sourceHandle) || filteredOut(filter, edge.target, edge.targetHandle);
        const style = direction
          ? { stroke: RELATION_COLOUR[direction], strokeWidth: 1.1, opacity: away ? DIM : 1 }
          : { stroke: "var(--edge)", strokeWidth: 0.75, opacity: lit || away ? DIM_EDGE : 1 };
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
          style,
          // Highlighted edges draw over dimmed ones, still under the boxes.
          zIndex: direction ? 1 : 0,
        };
      }),
    [model, lit, filter],
  );

  // Runs after the render that carries the new panel, so the fit measures the
  // state after the change. maxZoom pinned to the current zoom means the fit
  // can only pull back to bring the panel in, never push into it.
  useEffect(() => {
    if (opened === 0) return;
    void fitView({ maxZoom: getZoom(), padding: 0.04 });
  }, [opened, fitView, getZoom]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={flowEdges}
      nodeTypes={nodeTypes}
      // React Flow gives a node pointer events only when it's draggable,
      // selectable or there's a node click handler. Neither of the first two
      // applies here, so without this every click falls through to the pane.
      // Panels handle their own header and row clicks, so only folded nodes
      // act on it. Opening one also selects it, so its connections stand out
      // the moment it becomes a panel.
      onNodeClick={(_, node) => {
        if (node.type !== "folded") return;
        openFolder(node.id);
        setSelection({ kind: "node", id: node.id });
      }}
      onNodeMouseEnter={(_, node) => setHover({ kind: "node", id: node.id })}
      onNodeMouseLeave={() => setHover(null)}
      onPaneClick={() => setSelection(null)}
      fitView
      fitViewOptions={{ padding: 0.04, maxZoom: 1.25 }}
      minZoom={0.1}
      maxZoom={2}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      proOptions={{ hideAttribution: true }}
    />
  );
}

function FoldedNode({
  data: { item, dimmed, selected, relation, marked, matches },
}: NodeProps<Node<FoldedNodeData, "folded">>) {
  return (
    <div
      title={`${item.id} — click to open`}
      className={`flex size-full cursor-pointer flex-col justify-center rounded-[3px] border bg-surface px-[10px] text-left hover:border-accent ${selected ? "border-accent" : "border-border"}`}
      style={{ ...(relation ? relationBorder(relation) : undefined), ...(marked ? MARK : undefined) }}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} style={hidden} />
      <span
        className="truncate font-mono text-[12px] leading-4"
        style={{ ...fade(dimmed), color: relationText(relation) }}
      >
        {item.label}
      </span>
      <span className="text-[11px] leading-4 text-text-muted tabular-nums" style={fade(dimmed)}>
        <FileCount count={item.fileCount} matches={matches} />
      </span>
      <Fan fanIn={item.fanIn} fanOut={item.fanOut} className="text-[11px] leading-4" style={fade(dimmed)} />
      <Handle type="source" position={Position.Right} isConnectable={false} style={hidden} />
    </div>
  );
}

function PanelNode({
  id,
  data: { item, dimmed, selected, keptRows, selectedRow, relations, marked, markedHandle, matches, outside },
}: NodeProps<Node<PanelNodeData, "panel">>) {
  const { selection, setSelection, setHover, closeFolder, scrollPanel } = useMapState();
  const updateNodeInternals = useUpdateNodeInternals();
  const list = useRef<HTMLDivElement>(null);
  const rowDimmed = (handle: string) => dimmed || (keptRows !== null && !keptRows.has(handle)) || outside.has(handle);
  const visible = Math.min(item.rows.length, PANEL_ROWS);
  const scrolls = item.rows.length > PANEL_ROWS;

  // React Flow measures handle positions once; which rows have handles
  // changes with the scroll, so it has to measure again.
  useEffect(() => updateNodeInternals(id), [id, item.offset, updateNodeInternals]);

  // The offset can change from outside — selecting a file from the detail
  // pane scrolls its row into view — so the list follows it. Scrolling by
  // hand sets the same offset back, which changes nothing.
  useEffect(() => {
    const element = list.current;
    if (element && Math.round(element.scrollTop / PANEL_ROW) !== item.offset) {
      element.scrollTop = item.offset * PANEL_ROW;
    }
  }, [item.offset]);

  // Clicking what's already selected clears it, for panels and rows alike.
  const selectPanel = () =>
    setSelection(selection?.kind === "node" && selection.id === item.id ? null : { kind: "node", id: item.id });
  const selectRow = (path: string) =>
    setSelection(
      selection?.kind === "row" && selection.node === item.id && selection.path === path
        ? null
        : { kind: "row", node: item.id, path },
    );

  return (
    <div
      className={`flex size-full flex-col overflow-hidden rounded-[3px] border bg-surface ${selected ? "border-accent" : dimmed ? "border-border" : "border-text-muted"}`}
      style={marked ? MARK : undefined}
    >
      {/* The name selects the panel; the rest of the header closes it. */}
      <div
        onClick={() => closeFolder(item.id)}
        title={`${item.id} — click to close`}
        className="flex shrink-0 cursor-pointer flex-col justify-center border-b border-border bg-surface-raised px-[10px]"
        style={{ height: PANEL_HEADER }}
      >
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            selectPanel();
          }}
          title={`${item.id} — click to select`}
          className={`min-w-0 cursor-pointer self-start truncate text-left font-mono text-[12px] leading-4 font-medium hover:text-accent ${selected ? "text-accent" : ""}`}
          style={fade(dimmed)}
        >
          {item.label}
        </button>
        <span className="flex gap-2 text-[11px] leading-4 text-text-muted" style={fade(dimmed)}>
          <span className="tabular-nums">
            <FileCount count={item.fileCount} matches={matches} />
          </span>
          <Fan fanIn={item.fanIn} fanOut={item.fanOut} />
        </span>
      </div>
      {/* nowheel keeps the wheel scrolling the list instead of zooming the
          canvas. Snapping keeps whole rows in view, so every visible row has
          a handle exactly where it's drawn. */}
      <div
        ref={list}
        className="nowheel nopan nodrag shrink-0 snap-y snap-mandatory overflow-y-auto overscroll-contain"
        style={{ height: PANEL_ROW * visible }}
        onScroll={(event) => scrollPanel(item.id, Math.round(event.currentTarget.scrollTop / PANEL_ROW))}
      >
        {item.rows.map((row) => {
          const rowFade = fade(rowDimmed(row.path));
          return (
            <button
              type="button"
              key={row.path}
              onClick={() => selectRow(row.path)}
              // Leaving a row is still being over its panel.
              onMouseEnter={() => setHover({ kind: "file", path: row.path })}
              onMouseLeave={() => setHover({ kind: "node", id: item.id })}
              title={row.path}
              className={`flex w-full shrink-0 cursor-pointer snap-start items-center gap-2 px-[10px] text-left hover:bg-surface-raised ${selectedRow === row.path ? "bg-accent/10" : ""}`}
              style={{ height: PANEL_ROW, ...(markedHandle === row.path ? MARK_ROW : undefined) }}
            >
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-[2px]"
                style={{ ...rowFade, background: pathColour(row.path) }}
              />
              <span
                className={`min-w-0 truncate font-mono text-[11px] ${selectedRow === row.path ? "text-accent" : ""}`}
                style={{ ...rowFade, color: relationText(relations.get(row.path) ?? null) }}
              >
                {row.label}
              </span>
              <Fan fanIn={row.fanIn} fanOut={row.fanOut} className="ml-auto text-[10px]" style={rowFade} />
            </button>
          );
        })}
      </div>
      {scrolls && (
        <div
          className="flex shrink-0 items-center gap-3 border-t border-border px-[10px] text-[11px] text-text-muted tabular-nums"
          style={{ height: PANEL_ROW }}
        >
          <span
            style={{
              ...fade(rowDimmed(ABOVE)),
              color: relationText(relations.get(ABOVE) ?? null),
              ...(markedHandle === ABOVE ? MARK_ROW : undefined),
            }}
          >
            ↑ {item.above} above
          </span>
          <span
            style={{
              ...fade(rowDimmed(BELOW)),
              color: relationText(relations.get(BELOW) ?? null),
              ...(markedHandle === BELOW ? MARK_ROW : undefined),
            }}
          >
            ↓ {item.below} below
          </span>
        </div>
      )}
      {/* Handles live outside the scrolling list so it can't clip them: one
          per row in view, and one each at the top and bottom of the list for
          edges whose file is scrolled out of view. */}
      {item.rows.slice(item.offset, item.offset + visible).map((row, index) => (
        <RowHandles key={row.path} id={row.path} top={PANEL_HEADER + PANEL_ROW * index + PANEL_ROW / 2} />
      ))}
      {item.above > 0 && <RowHandles id={ABOVE} top={PANEL_HEADER + 1} />}
      {item.below > 0 && <RowHandles id={BELOW} top={PANEL_HEADER + PANEL_ROW * visible - 1} />}
    </div>
  );
}

// With a category picked, how many of the node's files are of it, marked with
// the category's own swatch.
function FileCount({ count, matches }: { count: number; matches: Match | null }) {
  if (!matches) return <>{count} files</>;
  return (
    <span className="inline-flex items-center gap-1" title={`${matches.count} of ${count} files are ${matches.type}`}>
      <span aria-hidden className="size-2 rounded-[2px]" style={{ background: typeColour(matches.type) }} />
      {matches.count} of {count}
    </span>
  );
}

const NONE: ReadonlySet<string> = new Set();

type Filter = { type: FileType; matches: ReadonlyMap<string, number>; outside: ReadonlyMap<string, ReadonlySet<string>> };

/** An end with nothing of the category in it: a folded node with no matches, or a row or line outside it. */
function filteredOut(filter: Filter | null, node: string, handle: string | null): boolean {
  if (filter === null) return false;
  return handle === null ? filter.matches.get(node) === 0 : (filter.outside.get(node)?.has(handle) ?? false);
}

// ←n in green is what imports this; n→ in yellow is what this imports. The
// same two colours mark edges and their ends when something is selected.
function Fan({
  fanIn,
  fanOut,
  className = "",
  style,
}: {
  fanIn: number;
  fanOut: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span className={`flex shrink-0 gap-2 font-mono tabular-nums ${className}`} style={style}>
      <span style={{ color: "var(--incoming)" }} title={`${fanIn} files import this`}>
        ←{fanIn}
      </span>
      <span style={{ color: "var(--outgoing)" }} title={`this imports ${fanOut} files`}>
        {fanOut}→
      </span>
    </span>
  );
}

// Around a selection: green for what imports it (it arrives, like ←), yellow
// for what it imports (it leaves, like →).
const RELATION_COLOUR = { importer: "var(--incoming)", imported: "var(--outgoing)" } as const;

function relationText(relation: Relation | null): string | undefined {
  return relation && relation !== "both" ? RELATION_COLOUR[relation] : undefined;
}

// Two-way connections split the border the way the fan reads: green on the
// left, yellow on the right.
function relationBorder(relation: Relation) {
  if (relation === "both") {
    return {
      borderColor: "var(--border)",
      borderLeftColor: RELATION_COLOUR.importer,
      borderRightColor: RELATION_COLOUR.imported,
    };
  }
  return { borderColor: RELATION_COLOUR[relation] };
}

// Handles sit on the panel's sides at the height of what they stand for, so an
// edge visibly lands on its row.
function RowHandles({ id, top }: { id: string; top: number }) {
  return (
    <>
      <Handle id={id} type="target" position={Position.Left} isConnectable={false} style={{ ...hidden, top }} />
      <Handle id={id} type="source" position={Position.Right} isConnectable={false} style={{ ...hidden, top }} />
    </>
  );
}

const hidden = { opacity: 0, pointerEvents: "none" } as const;

// Dimming fades what's drawn inside a box, never the box itself: a
// see-through box would let every edge behind it show through.
function fade(dimmed: boolean) {
  return { opacity: dimmed ? DIM : 1 };
}

const nodeTypes = { folded: FoldedNode, panel: PanelNode };
