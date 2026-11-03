"use client";

import { createContext, type ReactNode, use, useMemo, useState } from "react";
import type { FileType } from "@/graph/categories";
import { type Folding, fold } from "@/graph/fold";
import { PANEL_ROWS, panelOrder } from "@/graph/map";
import type { Selection } from "@/graph/selection";
import type { Edge, FileNode } from "@/parser/types";

// What the map and the detail pane share: which folders are open, how far each
// is scrolled, what's selected and what's hovered. It lives above both so a
// click in either moves the other, with no request in between: everything
// either of them shows is already in the browser.

/** Something pointed at in one place, to be marked in the other. */
export type Hover = { kind: "file"; path: string } | { kind: "node"; id: string };

interface MapState {
  files: readonly FileNode[];
  edges: readonly Edge[];
  folding: Folding;
  byPath: ReadonlyMap<string, FileNode>;
  open: ReadonlySet<string>;
  /** First visible row per open panel. Edges follow it, so it lives here. */
  scroll: ReadonlyMap<string, number>;
  selection: Selection | null;
  hover: Hover | null;
  /** Bumped only when a folder opens; closing one leaves the view where it is. */
  opened: number;
  /** The rail category picked: files of any other type dim, and stay where they are. */
  category: FileType | null;
  setCategory: (category: FileType | null) => void;
  setSelection: (selection: Selection | null) => void;
  setHover: (hover: Hover | null) => void;
  openFolder: (id: string) => void;
  closeFolder: (id: string) => void;
  scrollPanel: (id: string, offset: number) => void;
  /** Selects a file wherever it is: opens its folder and scrolls its row into view. */
  selectFile: (path: string) => void;
}

const MapStateContext = createContext<MapState | null>(null);

export function useMapState(): MapState {
  const state = use(MapStateContext);
  if (!state) throw new Error("useMapState needs a MapStateProvider above it");
  return state;
}

export function MapStateProvider({
  files,
  edges,
  children,
}: {
  files: readonly FileNode[];
  edges: readonly Edge[];
  children: ReactNode;
}) {
  const folding = useMemo(() => fold(files), [files]);
  const byPath = useMemo(() => new Map(files.map((file) => [file.path, file])), [files]);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [scroll, setScroll] = useState<ReadonlyMap<string, number>>(new Map());
  const [selection, setSelection] = useState<Selection | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [opened, setOpened] = useState(0);
  const [category, setCategory] = useState<FileType | null>(null);

  const state = useMemo<MapState>(() => {
    const openFolder = (id: string) => {
      if (open.has(id)) return;
      setOpen(new Set(open).add(id));
      setOpened((n) => n + 1);
    };
    return {
      files,
      edges,
      folding,
      byPath,
      open,
      scroll,
      selection,
      hover,
      opened,
      category,
      setCategory,
      setSelection,
      setHover,
      openFolder,
      closeFolder: (id) => {
        const next = new Set(open);
        next.delete(id);
        setOpen(next);
        // Reopening starts at the top again.
        const nextScroll = new Map(scroll);
        nextScroll.delete(id);
        setScroll(nextScroll);
        // A selection inside the closed panel no longer has anything to point at.
        if (selection && (selection.kind === "node" ? selection.id : selection.node) === id) setSelection(null);
      },
      scrollPanel: (id, offset) => {
        if ((scroll.get(id) ?? 0) !== offset) setScroll(new Map(scroll).set(id, offset));
      },
      selectFile: (path) => {
        const node = folding.nodeOf.get(path);
        if (node === undefined) return;
        openFolder(node);
        // A closed folder reopens at the top, whatever it was scrolled to before.
        const offset = open.has(node) ? (scroll.get(node) ?? 0) : 0;
        const index = panelOrder(folding.nodes.find((n) => n.id === node)!.files, byPath).findIndex(
          (file) => file.path === path,
        );
        if (index < offset || index >= offset + PANEL_ROWS) setScroll(new Map(scroll).set(node, index));
        setSelection({ kind: "row", node, path });
      },
    };
  }, [files, edges, folding, byPath, open, scroll, selection, hover, opened, category]);

  return <MapStateContext value={state}>{children}</MapStateContext>;
}
