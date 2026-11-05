"use client";

import { useState } from "react";
import { DependencyMap } from "@/components/dependency-map";
import { useMapState } from "@/components/map-state";
import { MARK, usePathTarget } from "@/components/path-row";
import type { Route, WithheldRoutes } from "@/parser/types";

// The centre of the workspace: the map, or every route the adapters read.
// The map stays mounted behind the routes, so switching back finds it where
// it was left. Selecting a route's file selects it on the map too.

type View = "map" | "routes";

export function WorkspaceViews({ withheld }: { withheld: readonly WithheldRoutes[] }) {
  const { routes } = useMapState();
  const [view, setView] = useState<View>("map");
  return (
    <div className="flex h-full flex-col">
      <div role="tablist" className="flex shrink-0 gap-4 border-b border-border bg-surface px-3 pt-2">
        <ViewTab view="map" current={view} onSelect={setView}>
          Map
        </ViewTab>
        <ViewTab view="routes" current={view} onSelect={setView}>
          Routes <span className="font-mono text-text-muted tabular-nums">{routes.length}</span>
        </ViewTab>
      </div>
      <div role="tabpanel" className={`min-h-0 flex-1 ${view === "map" ? "" : "hidden"}`}>
        <DependencyMap />
      </div>
      {view === "routes" && (
        <div role="tabpanel" className="min-h-0 flex-1 overflow-auto">
          <RoutesView routes={routes} withheld={withheld} />
        </div>
      )}
    </div>
  );
}

function ViewTab({
  view,
  current,
  onSelect,
  children,
}: {
  view: View;
  current: View;
  onSelect: (view: View) => void;
  children: React.ReactNode;
}) {
  const active = view === current;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => onSelect(view)}
      className={`-mb-px cursor-pointer border-b-2 pb-1.5 text-[12px] ${active ? "border-accent text-text" : "border-transparent text-text-muted hover:text-text"}`}
    >
      {children}
    </button>
  );
}

/**
 * Every route the adapters read off the code. A route that couldn't be read
 * exactly isn't here; why is listed under the table instead.
 */
function RoutesView({ routes, withheld }: { routes: readonly Route[]; withheld: readonly WithheldRoutes[] }) {
  return (
    <div className="py-2">
      <p className="px-3 pb-2 text-[12px] text-text-muted">
        Listed only where the method and the full path are both written in the code.
      </p>
      {routes.length === 0 ? (
        <p className="px-3 text-[12px] text-text-muted">No routes.</p>
      ) : (
        <table className="w-full table-fixed font-mono text-[12px]">
          <thead>
            <tr className="h-7 text-left font-sans text-[11px] text-text-muted">
              <th className="w-[80px] pl-3 font-normal">Method</th>
              <th className="w-[36%] font-normal">Pattern</th>
              <th className="pr-3 font-normal">Declared in</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((route) => (
              <RouteRow key={`${route.file}\0${route.method}\0${route.pattern}`} route={route} />
            ))}
          </tbody>
        </table>
      )}
      {withheld.length > 0 && (
        <div className="px-3 pt-3 text-[11px] text-text-muted">
          <p>Not listed, because the code doesn&apos;t pin them down:</p>
          <ul>
            {withheld.map((item) => (
              <li key={`${item.path}:${item.line}:${item.reason}`} className="leading-5">
                <span className="font-mono">
                  {item.path === "." ? "/" : item.path}
                  {item.line === null ? "" : `:${item.line}`}
                </span>{" "}
                {item.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** One route. The whole row selects its file. */
function RouteRow({ route }: { route: Route }) {
  const { marked, ...handlers } = usePathTarget(route.file);
  const at = route.line === null ? route.file : `${route.file}:${route.line}`;
  return (
    <tr
      {...handlers}
      className={`cursor-pointer align-top hover:bg-surface-raised ${marked ? "bg-surface-raised" : ""}`}
      style={marked ? MARK : undefined}
    >
      <td className="py-1 pl-3">{route.method}</td>
      <td className="py-1 pr-3 break-all">{route.pattern}</td>
      <td className="py-1 pr-3 break-all text-text-muted">{at}</td>
    </tr>
  );
}
