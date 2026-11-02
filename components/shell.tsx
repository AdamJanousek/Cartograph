import type { ReactNode } from "react";

// The shell every screen renders inside. The regions are fixed here: a narrow
// category rail on the left, the map in the centre, details and chat stacked
// on the right. Later phases fill them in and don't move them. Both the signed-in
// workspace and the preview route render through this, so they can't drift.
export function Shell({
  bar,
  rail,
  details,
  children,
}: {
  bar: ReactNode;
  rail?: ReactNode;
  details?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="grid h-dvh grid-rows-[40px_minmax(0,1fr)]">
      <header className="flex items-center gap-3 border-b border-border bg-surface px-3">
        <span className="font-mono text-[12px] font-semibold tracking-tight">
          cartograph
        </span>
        {bar}
      </header>
      <div className="grid min-h-0 grid-cols-[200px_minmax(0,1fr)_340px]">
        <nav
          aria-label="Categories"
          className="min-h-0 overflow-auto border-r border-border bg-surface"
        >
          {rail}
        </nav>
        <main aria-label="Map" className="min-h-0 overflow-hidden">
          {children}
        </main>
        <aside className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] border-l border-border bg-surface">
          <section
            aria-label="Details"
            className="min-h-0 overflow-auto border-b border-border"
          >
            {details}
          </section>
          <section aria-label="Chat" className="min-h-0 overflow-auto" />
        </aside>
      </div>
    </div>
  );
}
