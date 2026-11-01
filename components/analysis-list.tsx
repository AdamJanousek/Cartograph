import type { AnalysisStatus } from "@/types/database";
import {
  LIST_LIMIT,
  listAnalyses,
  type AnalysisListItem,
} from "@/utils/queries/analyses";

// State is told apart by shape, not colour: the palette reserves colour for
// import direction and file kind, and state is neither.
type Phase = "done" | "working" | "waiting" | "failed";

const PHASE: Record<AnalysisStatus, Phase> = {
  pending: "waiting",
  fetching: "working",
  selecting: "working",
  parsing: "working",
  storing: "working",
  complete: "done",
  failed: "failed",
};

function StateGlyph({ phase }: { phase: Phase }) {
  return (
    <svg
      viewBox="0 0 10 10"
      aria-hidden
      className="size-2.5 shrink-0 text-text-muted"
    >
      {phase === "done" && <circle cx="5" cy="5" r="4" fill="currentColor" />}
      {phase === "working" && (
        <>
          <circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" />
          <path d="M5 1.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />
        </>
      )}
      {phase === "waiting" && (
        <circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" />
      )}
      {phase === "failed" && (
        <path
          d="M2 2l6 6M8 2l-6 6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

// Computed once at render and never ticks; the exact time is in the tooltip.
function formatRelative(iso: string, now: number) {
  const elapsed = now - Date.parse(iso);
  for (const [unit, ms] of UNITS) {
    if (elapsed >= ms) return relative.format(-Math.floor(elapsed / ms), unit);
  }
  return "just now";
}

// Rendered on the server, so pinned to UTC rather than the server's zone.
function formatExact(iso: string) {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function Row({ analysis, now }: { analysis: AnalysisListItem; now: number }) {
  const phase = PHASE[analysis.status];

  return (
    <tr className="h-7 border-b border-border">
      <td className="truncate pr-4 pl-3 font-mono">
        {analysis.project && (
          <>
            <span className="text-text-muted">{analysis.project.owner}/</span>
            {analysis.project.name}
          </>
        )}
      </td>
      <td className="pr-4">
        <span className="flex items-center gap-1.5">
          <StateGlyph phase={phase} />
          <span className={phase === "done" ? "text-text-muted" : undefined}>
            {analysis.status}
          </span>
        </span>
      </td>
      <td className="pr-4 font-mono text-text-muted">
        {analysis.commit_sha ? analysis.commit_sha.slice(0, 7) : "—"}
      </td>
      <td className="pr-3 text-right text-text-muted tabular-nums">
        <time
          dateTime={analysis.updated_at}
          title={formatExact(analysis.updated_at)}
        >
          {formatRelative(analysis.updated_at, now)}
        </time>
      </td>
    </tr>
  );
}

export async function AnalysisList() {
  const { analyses, readAt: now } = await listAnalyses();

  if (analyses.length === 0) {
    return (
      <div className="max-w-[52ch] px-3 py-4">
        <p className="text-text">No analyses yet.</p>
        <p className="mt-1 text-text-muted">
          A repository analysed by anyone in this organization shows up here,
          for everyone in it.
        </p>
      </div>
    );
  }

  return (
    <>
      <table className="w-full table-fixed border-collapse text-left text-[12px]">
        <colgroup>
          <col />
          <col className="w-28" />
          <col className="w-24" />
          <col className="w-32" />
        </colgroup>
        <thead className="sticky top-0 bg-bg text-[11px] text-text-muted">
          <tr className="h-7 border-b border-border">
            <th className="pr-4 pl-3 font-normal">Repository</th>
            <th className="pr-4 font-normal">State</th>
            <th className="pr-4 font-normal">Commit</th>
            <th className="pr-3 text-right font-normal">Updated</th>
          </tr>
        </thead>
        <tbody>
          {analyses.map((analysis) => (
            <Row key={analysis.id} analysis={analysis} now={now} />
          ))}
        </tbody>
      </table>
      {analyses.length === LIST_LIMIT && (
        <p className="px-3 py-2 text-[11px] text-text-muted">
          Showing the {LIST_LIMIT} most recently started.
        </p>
      )}
    </>
  );
}
