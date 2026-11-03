"use client";

import { type ReactNode, useState } from "react";
import { PathRow, split } from "@/components/path-row";
import { type CountedFile, type Cycle, INSIGHT_KINDS, INSIGHT_SENTENCE, type InsightKind, type Insights } from "@/graph/insights";

// Facts about the edge list, in a panel that starts closed: this tool explains
// a repository and doesn't lead with a list of things about it. Inside, what
// nothing imports comes first, because that's where reading starts; loops and
// length read more like verdicts, so they sit underneath.

const TITLE: Record<InsightKind, string> = {
  unimported: "Imported by nothing",
  hubs: "Imported unusually often",
  cycles: "Import loops",
  long: "Long files",
};

/** Files a list shows before "show all". */
const ROWS = 8;

export function InsightsPanel({ insights }: { insights: Insights }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-border py-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-5 w-full cursor-pointer items-center gap-1 px-3 text-left text-[11px] font-medium text-text-muted hover:text-text"
      >
        <span aria-hidden className="w-2.5 font-mono">
          {open ? "▾" : "▸"}
        </span>
        Insights
      </button>
      {open && INSIGHT_KINDS.map((kind) => <Kind key={kind} kind={kind} insights={insights} />)}
    </div>
  );
}

function Kind({ kind, insights }: { kind: InsightKind; insights: Insights }) {
  const count = kind === "cycles" ? insights.cycles.length : insights[kind].length;
  return (
    <section className="pt-3">
      <h3 className="flex h-5 items-center justify-between px-3 text-[12px]">
        {TITLE[kind]}
        <span className="font-mono text-[11px] text-text-muted tabular-nums">{count}</span>
      </h3>
      <p className="px-3 pb-1 text-[11px] leading-4 text-text-muted">{INSIGHT_SENTENCE[kind]}</p>
      {count === 0 ? (
        <p className="px-3 text-[11px] text-text-muted">none</p>
      ) : kind === "cycles" ? (
        <Expandable items={insights.cycles} render={(cycle) => <Loop key={cycle.loop[0].path} cycle={cycle} />} />
      ) : (
        <Expandable
          items={insights[kind]}
          render={(file) => (
            <li key={file.path}>
              <PathRow path={file.path} trailing={trailing(kind, file)} />
            </li>
          )}
        />
      )}
    </section>
  );
}

function trailing(kind: Exclude<InsightKind, "cycles">, file: CountedFile): ReactNode {
  if (kind === "hubs") return <span style={{ color: "var(--incoming)" }}>←{file.count}</span>;
  if (kind === "unimported") return <span style={{ color: "var(--outgoing)" }}>{file.count}→</span>;
  return <span className="text-text-muted">{file.count}</span>;
}

function Expandable<T>({ items, render }: { items: readonly T[]; render: (item: T) => ReactNode }) {
  const [all, setAll] = useState(false);
  return (
    <>
      <ul>{(all ? items : items.slice(0, ROWS)).map(render)}</ul>
      {items.length > ROWS && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="cursor-pointer px-3 pt-1 text-[11px] text-text-muted hover:text-accent"
        >
          {all ? "show fewer" : `show all ${items.length}`}
        </button>
      )}
    </>
  );
}

/** One loop, in order. Each row imports the one below it; the last imports the first. */
function Loop({ cycle }: { cycle: Cycle }) {
  const first = split(cycle.loop[0].path)[1];
  return (
    <li className="pb-2">
      <p
        className="px-3 font-mono text-[11px] leading-5 text-text-muted tabular-nums"
        title={`${cycle.group} files reach one another through import loops. This is the shortest loop among them.`}
      >
        {cycle.loop.length} {cycle.loop.length === 1 ? "file" : "files"}
        {cycle.group > cycle.loop.length && ` · ${cycle.group} in its group`}
      </p>
      <ul>
        {cycle.loop.map((step) => (
          <li key={step.path}>
            <PathRow
              path={step.path}
              trailing={
                step.typeOnly ? (
                  <span className="font-sans text-[11px] text-text-muted" title="Only types are imported from the next file">
                    type
                  </span>
                ) : undefined
              }
            />
          </li>
        ))}
      </ul>
      <p className="truncate px-3 font-mono text-[11px] leading-5 text-text-muted" title={cycle.loop[0].path}>
        ↩ {first}
      </p>
    </li>
  );
}
