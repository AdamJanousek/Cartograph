"use client";

import { useMapState } from "@/components/map-state";
import type { RailCategory } from "@/parser/taxonomy";

// What the files are, in the framework's own words. Picking a category marks
// its files on the map with an accent bar, without moving or dimming
// anything, so where the category lives reads against the whole repository.
// Picking it again clears it. No swatches: the map's colours are file kinds,
// not these categories.
export function CategoryRail({ categories }: { categories: readonly RailCategory[] }) {
  const { category: active, setCategory } = useMapState();
  return (
    <div className="py-2">
      <h2 className="flex h-5 items-center justify-between px-3 pb-1 text-[11px] font-medium text-text-muted">
        Categories
        {active !== null && (
          <button type="button" onClick={() => setCategory(null)} className="cursor-pointer font-normal hover:text-accent">
            clear
          </button>
        )}
      </h2>
      <ul>
        {categories.map((category) => {
          const on = category.id === active?.id;
          const empty = category.count === 0;
          return (
            <li key={category.id}>
              <button
                type="button"
                aria-pressed={on}
                disabled={empty}
                onClick={() => setCategory(on ? null : category)}
                className={`flex h-6 w-full items-center gap-2 px-3 text-left text-[12px] ${empty ? "text-text-muted" : "cursor-pointer hover:bg-surface-raised"} ${on ? "bg-surface-raised" : ""} ${active !== null && !on ? "text-text-muted" : ""}`}
                style={on ? { boxShadow: "inset 2px 0 0 var(--accent)" } : undefined}
              >
                <span className="min-w-0 flex-1 truncate">{category.label}</span>
                <span className="font-mono text-[11px] text-text-muted tabular-nums">{category.count}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
