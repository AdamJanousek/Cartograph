"use client";

import { typeColour } from "@/components/file-type";
import { useMapState } from "@/components/map-state";
import type { Category } from "@/graph/categories";

// Picking a category dims every file of another type on the map, without
// moving or removing anything, so where the category lives reads against the
// shape of the whole repository. Picking it again clears it.
export function CategoryRail({ categories }: { categories: readonly Category[] }) {
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
          const on = category.type === active;
          return (
            <li key={category.type}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => setCategory(on ? null : category.type)}
                className={`flex h-6 w-full cursor-pointer items-center gap-2 px-3 text-left text-[12px] hover:bg-surface-raised ${on ? "bg-surface-raised" : ""} ${active !== null && !on ? "text-text-muted" : ""}`}
                style={on ? { boxShadow: "inset 2px 0 0 var(--accent)" } : undefined}
              >
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-[2px]"
                  style={{ background: typeColour(category.type) }}
                />
                <span className="min-w-0 flex-1 truncate font-mono">{category.type}</span>
                <span className="font-mono text-[11px] text-text-muted tabular-nums">{category.count}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
