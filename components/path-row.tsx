"use client";

import type { ReactNode } from "react";
import { useMapState } from "@/components/map-state";

// File paths as the side panels show them. Every one is a way onto the map:
// clicking selects the file there, hovering marks it there, and hovering it on
// the map marks it here.

export const MARK = { outline: "1px solid var(--accent)", outlineOffset: -1 } as const;

/** Pointer handlers shared by every file path in a panel. */
export function usePathTarget(path: string) {
  const { hover, setHover, selectFile, folding } = useMapState();
  const marked =
    hover !== null && (hover.kind === "file" ? hover.path === path : folding.nodeOf.get(path) === hover.id);
  return {
    marked,
    onClick: () => {
      selectFile(path);
      // The row under the pointer is about to be a different file.
      setHover(null);
    },
    onMouseEnter: () => setHover({ kind: "file", path }),
    onMouseLeave: () => setHover(null),
  };
}

export function split(path: string): [dir: string, base: string] {
  const slash = path.lastIndexOf("/");
  return [path.slice(0, slash + 1), path.slice(slash + 1)];
}

/**
 * A file path in a list. Clicking moves the map's selection to it; hovering
 * marks it on the map; it's marked here in turn when it, or the folded node
 * holding it, is hovered on the map. The folder truncates, the name never does.
 */
export function PathRow({ path, trailing }: { path: string; trailing?: ReactNode }) {
  const { marked, ...handlers } = usePathTarget(path);
  const [dir, base] = split(path);
  return (
    <button
      type="button"
      title={path}
      {...handlers}
      className={`flex h-6 w-full cursor-pointer items-center gap-3 px-3 text-left font-mono text-[12px] hover:bg-surface-raised ${marked ? "bg-surface-raised" : ""}`}
      style={marked ? MARK : undefined}
    >
      <span className="flex min-w-0 flex-1 overflow-hidden">
        <span className="min-w-0 truncate text-text-muted">{dir}</span>
        <span className="shrink-0">{base}</span>
      </span>
      {trailing !== undefined && <span className="shrink-0 tabular-nums">{trailing}</span>}
    </button>
  );
}
