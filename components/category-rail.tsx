import type { Category } from "@/graph/categories";

// Every swatch is the unlabelled grey because no adapter produces a role yet;
// hues arrive with the first one. Plain rows, not buttons: clicking a category
// does nothing yet, and a control that looks clickable and isn't is worse than
// one that doesn't look clickable.
export function CategoryRail({ categories }: { categories: readonly Category[] }) {
  return (
    <div className="py-2">
      <h2 className="px-3 pb-1 text-[11px] font-medium text-text-muted">
        Categories
      </h2>
      <ul>
        {categories.map((category) => (
          <li
            key={category.role ?? ""}
            className="flex h-6 items-center gap-2 px-3 text-[12px]"
          >
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-[2px]"
              style={{ background: "var(--kind-unlabelled)" }}
            />
            <span className="min-w-0 flex-1 truncate">
              {category.role ?? "unlabelled"}
            </span>
            <span className="font-mono text-[11px] text-text-muted tabular-nums">
              {category.count}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
