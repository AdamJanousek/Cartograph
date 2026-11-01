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
} from "@xyflow/react";
import { createContext, use, useCallback, useEffect, useMemo, useState } from "react";
import { fold } from "@/graph/fold";
import {
  buildMap,
  type FoldedItem,
  MORE,
  PANEL_HEADER,
  PANEL_ROW,
  type PanelItem,
} from "@/graph/map";
import type { Edge, FileNode } from "@/parser/types";

type FoldedNodeData = { item: FoldedItem };
type PanelNodeData = { item: PanelItem };
type MapNode = Node<FoldedNodeData, "folded"> | Node<PanelNodeData, "panel">;

const ToggleContext = createContext<(id: string) => void>(() => {});

export function DependencyMap(props: { files: FileNode[]; edges: Edge[] }) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

function Canvas({ files, edges }: { files: FileNode[]; edges: Edge[] }) {
  const folding = useMemo(() => fold(files), [files]);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  // Bumped only when a folder opens; closing one leaves the view where it is.
  const [opened, setOpened] = useState(0);
  const { fitView, getZoom } = useReactFlow();

  const toggle = useCallback(
    (id: string) => {
      const next = new Set(open);
      if (!next.delete(id)) {
        next.add(id);
        setOpened((n) => n + 1);
      }
      setOpen(next);
    },
    [open],
  );

  const model = useMemo(() => buildMap(files, edges, folding, open), [files, edges, folding, open]);

  const nodes = useMemo<MapNode[]>(
    () =>
      model.items.map((item) => {
        const common = {
          id: item.id,
          position: { x: item.x, y: item.y },
          width: item.width,
          height: item.height,
        };
        return item.kind === "folded"
          ? { ...common, type: "folded", data: { item } }
          : { ...common, type: "panel", data: { item } };
      }),
    [model],
  );

  const flowEdges = useMemo(
    () =>
      model.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      })),
    [model],
  );

  // Runs after the render that carries the new panel, so the fit measures the
  // state after the change. maxZoom pinned to the current zoom means the fit
  // can only pull back to bring the panel in, never push into it.
  useEffect(() => {
    if (opened === 0) return;
    void fitView({ maxZoom: getZoom(), padding: 0.04 });
  }, [opened, fitView, getZoom]);

  return (
    <ToggleContext value={toggle}>
      <ReactFlow
        nodes={nodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.04, maxZoom: 1.25 }}
        minZoom={0.1}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        defaultEdgeOptions={{ style: { stroke: "var(--edge)", strokeWidth: 1 } }}
        proOptions={{ hideAttribution: true }}
      />
    </ToggleContext>
  );
}

function FoldedNode({ data: { item } }: NodeProps<Node<FoldedNodeData, "folded">>) {
  const toggle = use(ToggleContext);
  return (
    <button
      type="button"
      onClick={() => toggle(item.id)}
      title={item.id}
      className="flex size-full cursor-pointer flex-col justify-center rounded-[3px] border border-border bg-surface px-[10px] text-left hover:border-accent"
    >
      <Handle type="target" position={Position.Left} isConnectable={false} style={hidden} />
      <span className="truncate font-mono text-[12px] leading-4">{item.label}</span>
      <span className="text-[11px] leading-4 text-text-muted tabular-nums">{item.fileCount} files</span>
      <Handle type="source" position={Position.Right} isConnectable={false} style={hidden} />
    </button>
  );
}

function PanelNode({ data: { item } }: NodeProps<Node<PanelNodeData, "panel">>) {
  const toggle = use(ToggleContext);
  return (
    <div className="flex size-full flex-col overflow-hidden rounded-[3px] border border-text-muted bg-surface">
      <button
        type="button"
        onClick={() => toggle(item.id)}
        title={`${item.id} — click to close`}
        className="flex shrink-0 cursor-pointer items-center gap-2 border-b border-border bg-surface-raised px-[10px] text-left text-[11px] hover:text-accent"
        style={{ height: PANEL_HEADER }}
      >
        <span className="min-w-0 truncate font-mono text-[12px] font-medium">{item.label}</span>
        <span className="ml-auto shrink-0 text-text-muted tabular-nums">
          {item.fileCount} files · in {item.fanIn} · out {item.fanOut}
        </span>
      </button>
      {item.rows.map((row, index) => (
        <div
          key={row.path}
          title={row.path}
          className="flex shrink-0 items-center gap-2 px-[10px]"
          style={{ height: PANEL_ROW }}
        >
          <RowHandles id={row.path} index={index} />
          <span className="min-w-0 truncate font-mono text-[11px]">{row.label}</span>
          <span className="ml-auto shrink-0 font-mono text-[10px] text-text-muted tabular-nums">
            {row.fanIn}
          </span>
        </div>
      ))}
      {item.more > 0 && (
        <div
          className="flex shrink-0 items-center px-[10px] text-[11px] text-text-muted"
          style={{ height: PANEL_ROW }}
        >
          <RowHandles id={MORE} index={item.rows.length} />
          {item.more} more
        </div>
      )}
    </div>
  );
}

// Handles sit on the panel's edges at the row's height, so an edge visibly
// lands on the row it belongs to.
function RowHandles({ id, index }: { id: string; index: number }) {
  const top = PANEL_HEADER + PANEL_ROW * index + PANEL_ROW / 2;
  return (
    <>
      <Handle id={id} type="target" position={Position.Left} isConnectable={false} style={{ ...hidden, top }} />
      <Handle id={id} type="source" position={Position.Right} isConnectable={false} style={{ ...hidden, top }} />
    </>
  );
}

const hidden = { opacity: 0, pointerEvents: "none" } as const;

const nodeTypes = { folded: FoldedNode, panel: PanelNode };
