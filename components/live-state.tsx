"use client";

import type { AnalysisStatus } from "@/types/database";
import { isFinished } from "@/utils/progress";
import { PHASE, StateGlyph } from "./state-glyph";
import { useAnalysisStage } from "./use-analysis-stage";

// One dashboard row's state. Only a run that may still move subscribes: a
// finished or stale one has nothing left to say.
export function LiveState({
  analysisId,
  status,
  updatedAt,
  stale,
}: {
  analysisId: string;
  status: AnalysisStatus;
  updatedAt: string;
  stale: boolean;
}) {
  const { event } = useAnalysisStage(
    analysisId,
    { stage: status, message: null },
    updatedAt,
    !isFinished(status) && !stale,
  );
  const phase = PHASE[event.stage];
  // Whatever arrives live is by definition recent, so it's no longer stale.
  const showStale = stale && event.stage === status;

  return (
    <span className="flex items-center gap-1.5">
      <StateGlyph phase={showStale ? "waiting" : phase} />
      <span className={phase === "done" || showStale ? "text-text-muted" : undefined}>
        {event.stage}
      </span>
      {showStale && (
        <span
          className="text-[11px] text-text-muted"
          title="Unfinished and unchanged for over ten minutes. The run has most likely stopped."
        >
          · stale
        </span>
      )}
    </span>
  );
}
