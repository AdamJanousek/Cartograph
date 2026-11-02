"use client";

import { type ReactNode, useMemo, useState } from "react";
import { typeColour } from "@/components/file-type";
import { useMapState } from "@/components/map-state";
import {
  type FileDetail,
  type FolderDetail,
  fileDetail,
  folderDetail,
  type Neighbour,
  type RankedFile,
  type RepositorySummary,
} from "@/graph/summary";

// The right-hand pane. With nothing selected it describes the repository; with
// a file or folder selected it describes that. Everything here is computed from
// data the page already carries, so selecting fires no request.

type Tab = "structure" | "explanation";

/** How many rows a summary list shows before "show all". */
const SUMMARY_ROWS = 10;

// Green ← is what arrives (importers), yellow → what leaves (imports), as on the map.
const INCOMING = "var(--incoming)";
const OUTGOING = "var(--outgoing)";

const MARK = { outline: "1px solid var(--accent)", outlineOffset: -1 } as const;

export function DetailPane({ name, summary }: { name: string; summary: RepositorySummary }) {
  const { selection, folding, byPath, edges } = useMapState();
  // Kept here, above the selection, so switching files keeps the tab that's open.
  const [tab, setTab] = useState<Tab>("structure");

  const detail = useMemo((): { kind: "file"; file: FileDetail } | { kind: "folder"; folder: FolderDetail } | null => {
    if (!selection) return null;
    if (selection.kind === "row") {
      const file = byPath.get(selection.path);
      return file ? { kind: "file", file: fileDetail(file, edges) } : null;
    }
    const node = folding.nodes.find((n) => n.id === selection.id);
    return node ? { kind: "folder", folder: folderDetail(node, byPath, edges) } : null;
  }, [selection, folding, byPath, edges]);

  if (!detail) return <RepositoryView name={name} summary={summary} />;

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 px-3 pt-2">
        <p className="text-[11px] text-text-muted">{detail.kind}</p>
        {detail.kind === "file" ? (
          <TitlePath path={detail.file.file.path} />
        ) : (
          <h2 className="font-mono text-[14px] leading-5 font-semibold break-all">
            {detail.folder.id === "." ? "/" : detail.folder.id}
          </h2>
        )}
      </header>
      <div role="tablist" className="flex shrink-0 gap-4 border-b border-border px-3 pt-2">
        <TabButton tab="structure" current={tab} onSelect={setTab}>
          Structure
        </TabButton>
        <TabButton tab="explanation" current={tab} onSelect={setTab}>
          Explanation
        </TabButton>
      </div>
      <div role="tabpanel" className="min-h-0 flex-1 overflow-auto">
        {tab === "explanation" ? (
          <p className="px-3 py-3 text-[12px] text-text-muted">No explanation yet.</p>
        ) : detail.kind === "file" ? (
          <FileView detail={detail.file} />
        ) : (
          <FolderView detail={detail.folder} />
        )}
      </div>
    </div>
  );
}

function TabButton({
  tab,
  current,
  onSelect,
  children,
}: {
  tab: Tab;
  current: Tab;
  onSelect: (tab: Tab) => void;
  children: ReactNode;
}) {
  const active = tab === current;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => onSelect(tab)}
      className={`-mb-px cursor-pointer border-b-2 pb-1.5 text-[12px] ${active ? "border-accent text-text" : "border-transparent text-text-muted hover:text-text"}`}
    >
      {children}
    </button>
  );
}

function RepositoryView({ name, summary }: { name: string; summary: RepositorySummary }) {
  return (
    <div className="h-full overflow-auto">
      <header className="px-3 pt-2">
        <p className="text-[11px] text-text-muted">repository</p>
        <h2 className="font-mono text-[14px] leading-5 font-semibold break-all">{name}</h2>
      </header>
      <Facts>
        <Fact label="Framework">{summary.framework ?? <span className="text-text-muted">none detected</span>}</Fact>
        <Fact label="Files">
          {summary.files}
          {summary.skipped > 0 && <span className="text-text-muted"> · {summary.skipped} skipped</span>}
        </Fact>
        <Fact label="Imports">
          {summary.imports}
          <span className="text-text-muted"> · {summary.resolvedImports} to files here</span>
        </Fact>
        {/* The parse records no routes, so there's no number to show. A zero
            would claim it looked and found none. */}
        <Fact label="Routes">
          <span className="text-text-muted" title="This parse records no routes">
            —
          </span>
        </Fact>
        <Fact label="Unidentified">
          {summary.unidentified}
          <span className="text-text-muted"> of {summary.files} files</span>
        </Fact>
      </Facts>
      <RankedList
        title="Most depended on"
        files={summary.mostDependedOn}
        count={(file) => <span style={{ color: INCOMING }}>←{file.count}</span>}
      />
      <RankedList
        title="Imported by nothing"
        files={summary.unimported}
        count={(file) => <span style={{ color: OUTGOING }}>{file.count}→</span>}
      />
    </div>
  );
}

function RankedList({
  title,
  files,
  count,
}: {
  title: string;
  files: readonly RankedFile[];
  count: (file: RankedFile) => ReactNode;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? files : files.slice(0, SUMMARY_ROWS);
  return (
    <Section title={title} count={<span className="text-text-muted">{files.length}</span>}>
      <ul>
        {shown.map((file) => (
          <li key={file.path}>
            <PathRow path={file.path} trailing={count(file)} />
          </li>
        ))}
      </ul>
      {files.length > SUMMARY_ROWS && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="cursor-pointer px-3 pt-1 text-[11px] text-text-muted hover:text-accent"
        >
          {all ? "show fewer" : `show all ${files.length}`}
        </button>
      )}
    </Section>
  );
}

function FileView({ detail }: { detail: FileDetail }) {
  const { file, type, imports, importers } = detail;
  return (
    <>
      <Facts>
        <Fact label="Kind">
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className="size-2.5 rounded-[2px]" style={{ background: typeColour(type) }} />
            {type}
          </span>
        </Fact>
        <Fact label="Folder">{file.folder === "." ? "/" : file.folder}</Fact>
        <Fact label="Length">{file.lines} lines</Fact>
        {/* The same lists' lengths as the sections below, so the two always agree. */}
        <Fact label="Depends on">
          <span style={{ color: OUTGOING }}>{imports.length}</span> files
        </Fact>
        <Fact label="Depended on by">
          <span style={{ color: INCOMING }}>{importers.length}</span> files
        </Fact>
      </Facts>
      <NeighbourList title="Imports" neighbours={imports} count={<span style={{ color: OUTGOING }}>{imports.length}→</span>} />
      <NeighbourList
        title="Imported by"
        neighbours={importers}
        count={<span style={{ color: INCOMING }}>←{importers.length}</span>}
      />
    </>
  );
}

function NeighbourList({
  title,
  neighbours,
  count,
}: {
  title: string;
  neighbours: readonly Neighbour[];
  count: ReactNode;
}) {
  return (
    <Section title={title} count={count}>
      {neighbours.length === 0 ? (
        <p className="px-3 text-[12px] text-text-muted">none</p>
      ) : (
        <ul>
          {neighbours.map((neighbour) => (
            <li key={neighbour.path}>
              <PathRow
                path={neighbour.path}
                trailing={
                  neighbour.typeOnly ? (
                    <span className="font-sans text-[11px] text-text-muted" title="Only types are imported">
                      type
                    </span>
                  ) : undefined
                }
              />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function FolderView({ detail }: { detail: FolderDetail }) {
  return (
    <>
      <Facts>
        <Fact label="Files">{detail.files}</Fact>
        <Fact label="Depends on">
          <span style={{ color: OUTGOING }}>{detail.fanOut}</span> files outside
        </Fact>
        <Fact label="Depended on by">
          <span style={{ color: INCOMING }}>{detail.fanIn}</span> files outside
        </Fact>
      </Facts>
      <Section title="Kinds" count={<span className="text-text-muted">{detail.types.length}</span>}>
        <ul>
          {detail.types.map((category) => (
            <li key={category.type} className="flex h-6 items-center gap-2 px-3 font-mono text-[12px]">
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-[2px]"
                style={{ background: typeColour(category.type) }}
              />
              <span className="flex-1">{category.type}</span>
              <span className="text-text-muted tabular-nums">{category.count}</span>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

function Facts({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-6 px-3 py-3 text-[12px] leading-6">{children}</dl>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-text-muted">{label}</dt>
      <dd className="min-w-0 truncate font-mono tabular-nums">{children}</dd>
    </>
  );
}

function Section({ title, count, children }: { title: string; count: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-border py-2">
      <h3 className="flex h-7 items-center justify-between px-3 text-[12px]">
        {title}
        <span className="font-mono tabular-nums">{count}</span>
      </h3>
      {children}
    </section>
  );
}

/** Pointer handlers shared by every file path in the pane. */
function usePathTarget(path: string) {
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

function split(path: string): [dir: string, base: string] {
  const slash = path.lastIndexOf("/");
  return [path.slice(0, slash + 1), path.slice(slash + 1)];
}

/** The selected file's own path: wraps rather than truncates, name brighter than folder. */
function TitlePath({ path }: { path: string }) {
  const { marked, ...handlers } = usePathTarget(path);
  const [dir, base] = split(path);
  return (
    <button
      type="button"
      title={path}
      {...handlers}
      className="block cursor-pointer text-left font-mono text-[14px] leading-5 break-all"
      style={marked ? MARK : undefined}
    >
      <span className="text-text-muted">{dir}</span>
      <span className="font-semibold">{base}</span>
    </button>
  );
}

/**
 * A file path in a list. Clicking moves the map's selection to it; hovering
 * marks it on the map; it's marked here in turn when it, or the folded node
 * holding it, is hovered on the map. The folder truncates, the name never does.
 */
function PathRow({ path, trailing }: { path: string; trailing?: ReactNode }) {
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
      <span className="flex min-w-0 flex-1">
        <span className="min-w-0 truncate text-text-muted">{dir}</span>
        <span className="shrink-0">{base}</span>
      </span>
      {trailing !== undefined && <span className="shrink-0 tabular-nums">{trailing}</span>}
    </button>
  );
}
