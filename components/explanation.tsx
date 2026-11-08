"use client";

import { type ReactNode, useTransition } from "react";
import { type ExplainOutcome, explainTarget, reanalyse } from "@/app/(workspace)/actions";
import type { Tracing } from "@/ai/client";
import type { ExplainTarget } from "@/ai/explain";
import { useMapState } from "@/components/map-state";
import { MARK, usePathTarget } from "@/components/path-row";
import type { Freshness } from "@/pipeline/freshness";

// The Explanation tab. What's been fetched is held by the pane above, keyed by
// what was explained, so moving the selection away and back shows it again
// with no second click. Clicking Explain again asks the server, which answers
// from its cache: that's the run that shows up traced with no model call.

export type Fetched = { state: "loading" } | { state: "done"; outcome: ExplainOutcome };

export function targetKey(target: ExplainTarget): string {
  return target.kind === "file" ? `file:${target.path}` : `folder:${target.id}`;
}

export function ExplanationView({
  analysisId,
  target,
  fetched,
  onFetched,
  tracing,
}: {
  analysisId: string;
  target: ExplainTarget;
  fetched: Fetched | undefined;
  onFetched: (key: string, fetched: Fetched) => void;
  tracing: Tracing;
}) {
  const loading = fetched?.state === "loading";
  const outcome = fetched?.state === "done" ? fetched.outcome : null;

  const run = () => {
    // Keyed by the target asked about, not whatever is selected when it answers.
    const key = targetKey(target);
    onFetched(key, { state: "loading" });
    explainTarget(analysisId, target).then(
      (result) => onFetched(key, { state: "done", outcome: result }),
      (error: unknown) =>
        onFetched(key, {
          state: "done",
          outcome: { ok: false, error: error instanceof Error ? error.message : String(error), freshness: null },
        }),
    );
  };

  return (
    <div className="flex flex-col gap-3 px-3 py-3 text-[12px]">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="h-6 cursor-pointer rounded-[3px] border border-border px-2 hover:border-accent hover:text-accent disabled:cursor-default disabled:text-text-muted disabled:hover:border-border"
        >
          {loading ? "Explaining…" : "Explain"}
        </button>
        {outcome?.ok && (
          <span className="font-mono text-[11px] text-text-muted">
            {outcome.explanation.model}
            {outcome.explanation.cached && " · cached"}
          </span>
        )}
      </div>

      {outcome?.freshness && <FreshnessNote analysisId={analysisId} freshness={outcome.freshness} kind={target.kind} />}

      {outcome && !outcome.ok && <p>Couldn&apos;t explain this: {outcome.error}</p>}
      {outcome?.ok && <Prose text={outcome.explanation.body} />}
      {!outcome && !loading && (
        <p className="text-text-muted">
          {target.kind === "file"
            ? "Explains this file from its source and every file it imports or is imported by."
            : "Explains this folder as a whole: what's in it, and why the files outside depend on it."}
        </p>
      )}

      <p className="border-t border-border pt-2 text-[11px] text-text-muted">
        {tracing.on ? (
          <>
            Traced to LangSmith project <span className="font-mono">{tracing.project}</span>
          </>
        ) : (
          <>Not traced: {tracing.reason}. Calls still work, but nothing records them.</>
        )}
      </p>
    </div>
  );
}

function FreshnessNote({ analysisId, freshness, kind }: { analysisId: string; freshness: Freshness; kind: ExplainTarget["kind"] }) {
  if (freshness.state === "current") return null;
  if (freshness.state === "unknown") {
    return <p className="text-text-muted">Couldn&apos;t check whether the repository has changed: {freshness.reason}</p>;
  }
  const head = freshness.head.slice(0, 7);
  const message =
    freshness.state === "changed"
      ? `Stale: this file has changed since it was analysed. The repository is now at ${head}, and this explains the analysed version.`
      : freshness.state === "removed"
        ? `Stale: this file no longer exists at ${head}, where the repository is now.`
        : kind === "file"
          ? `The repository has moved on to ${head} since it was analysed. This file is unchanged, but its neighbours may not be.`
          : `Stale: the repository has moved on to ${head} since it was analysed.`;
  return (
    <div className="rounded-[3px] border border-border px-2 py-2">
      <p>{message}</p>
      <ReanalyseButton analysisId={analysisId} />
    </div>
  );
}

/** Runs the analysis again on the repository as it is now, and shows its progress. */
export function ReanalyseButton({ analysisId }: { analysisId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => reanalyse(analysisId))}
      className="mt-2 h-6 cursor-pointer rounded-[3px] border border-border px-2 text-[12px] hover:border-accent hover:text-accent disabled:cursor-default disabled:text-text-muted"
    >
      {pending ? "Starting…" : "Re-analyse"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// The three permitted pieces of formatting
// ---------------------------------------------------------------------------

type Block = { kind: "paragraph"; text: string } | { kind: "list"; items: string[] };

const BULLET = /^\s*[-*•]\s+/;
// Not permitted, but if one arrives it is shown as text rather than as a
// stray run of hashes.
const HEADING = /^\s*#{1,6}\s+/;

function blocks(text: string): Block[] {
  const out: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) out.push({ kind: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      flush();
    } else if (BULLET.test(line)) {
      flush();
      const last = out[out.length - 1];
      const item = line.replace(BULLET, "");
      if (last?.kind === "list") last.items.push(item);
      else out.push({ kind: "list", items: [item] });
    } else if (HEADING.test(line)) {
      flush();
      out.push({ kind: "paragraph", text: `**${line.replace(HEADING, "").replace(/\*\*/g, "")}**` });
    } else {
      // A wrapped continuation of a bullet joins it.
      const last = out[out.length - 1];
      if (!paragraph.length && last?.kind === "list" && /^\s+/.test(line)) last.items[last.items.length - 1] += ` ${line.trim()}`;
      else paragraph.push(line.trim());
    }
  }
  flush();
  return out;
}

export function Prose({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2 leading-[1.6]">
      {blocks(text).map((block, index) =>
        block.kind === "paragraph" ? (
          <p key={index}>
            <Inline text={block.text} />
          </p>
        ) : (
          <ul key={index} className="flex list-disc flex-col gap-1 pl-4">
            {block.items.map((item, i) => (
              <li key={i}>
                <Inline text={item} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

const INLINE = /(`[^`\n]+`|\*\*[^\n]+?\*\*)/g;

function Inline({ text }: { text: string }) {
  const parts = text.split(INLINE);
  return (
    <>
      {parts.map((part, index) => {
        if (index % 2 === 0) return <Linked key={index} text={part.replace(/`|\*\*/g, "")} />;
        if (part.startsWith("`")) return <Code key={index} text={part.slice(1, -1)} />;
        return (
          <strong key={index} className="font-semibold">
            <Inline text={part.slice(2, -2)} />
          </strong>
        );
      })}
    </>
  );
}

function Code({ text }: { text: string }) {
  const target = useResolve()(text);
  if (target) return <PathLink target={target} text={text} />;
  return <code className="rounded-[2px] bg-surface-raised px-1 font-mono text-[11px]">{text}</code>;
}

const EDGE_PUNCTUATION = /^[("'“‘[]+|[)"'”’\].,;:!?]+$/g;

/** Plain prose, with any repository path written in it turned into a link. */
function Linked({ text }: { text: string }) {
  const resolve = useResolve();
  const pieces = text.split(/(\s+)/);
  const out: ReactNode[] = [];
  let plain = "";
  pieces.forEach((piece, index) => {
    const bare = piece.replace(EDGE_PUNCTUATION, "");
    const target = bare.includes("/") || bare.includes(".") ? (resolve(piece) ?? resolve(bare)) : null;
    if (!target) {
      plain += piece;
      return;
    }
    const at = piece.indexOf(target.text);
    out.push(plain + piece.slice(0, at));
    out.push(<PathLink key={index} target={target} text={target.text} />);
    plain = piece.slice(at + target.text.length);
  });
  out.push(plain);
  return <>{out}</>;
}

type Resolved = { kind: "file"; path: string; text: string } | { kind: "folder"; id: string; text: string };

/** A path as the model wrote it, matched against the map. Only real files and folded folders resolve. */
function useResolve(): (written: string) => Resolved | null {
  const { byPath, folding } = useMapState();
  return (written) => {
    const text = written.trim();
    const path = text.replace(/^\.\//, "").replace(/\/$/, "");
    if (byPath.has(path)) return { kind: "file", path, text };
    if (path !== "." && folding.nodes.some((node) => node.id === path)) return { kind: "folder", id: path, text };
    return null;
  };
}

function PathLink({ target, text }: { target: Resolved; text: string }) {
  return target.kind === "file" ? <FileLink path={target.path} text={text} /> : <FolderLink id={target.id} text={text} />;
}

function FileLink({ path, text }: { path: string; text: string }) {
  const { marked, ...handlers } = usePathTarget(path);
  return (
    <button
      type="button"
      title={path}
      {...handlers}
      className="cursor-pointer font-mono text-[11px] text-accent hover:underline"
      style={marked ? MARK : undefined}
    >
      {text}
    </button>
  );
}

function FolderLink({ id, text }: { id: string; text: string }) {
  const { setSelection, setHover, hover } = useMapState();
  const marked = hover?.kind === "node" && hover.id === id;
  return (
    <button
      type="button"
      title={id}
      onClick={() => {
        setSelection({ kind: "node", id });
        setHover(null);
      }}
      onMouseEnter={() => setHover({ kind: "node", id })}
      onMouseLeave={() => setHover(null)}
      className="cursor-pointer font-mono text-[11px] text-accent hover:underline"
      style={marked ? MARK : undefined}
    >
      {text}
    </button>
  );
}
