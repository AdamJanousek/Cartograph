import type { AnalysisStatus } from "@/types/database";

// State is told apart by shape, not colour: the palette reserves colour for
// import direction and file kind, and state is neither.
export type Phase = "done" | "working" | "waiting" | "failed";

export const PHASE: Record<AnalysisStatus, Phase> = {
  pending: "waiting",
  fetching: "working",
  selecting: "working",
  parsing: "working",
  storing: "working",
  complete: "done",
  failed: "failed",
};

export function StateGlyph({ phase }: { phase: Phase }) {
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
