"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { isFinished, STAGE_LABEL, STAGES } from "@/utils/progress";
import type { AnalysisDetail } from "@/utils/queries/analyses";
import { StateGlyph, type Phase } from "./state-glyph";
import { useAnalysisStage } from "./use-analysis-stage";

export function AnalysisProgress({ analysis, stale }: { analysis: AnalysisDetail; stale: boolean }) {
  const router = useRouter();
  const finished = isFinished(analysis.status);
  const { event, connection } = useAnalysisStage(
    analysis.id,
    { stage: analysis.status, message: analysis.stage_message },
    analysis.updated_at,
    !finished && !stale,
  );

  // The live event says only that the run ended. Why it failed, and where, is
  // on the row, so the server reads it again.
  useEffect(() => {
    if (!finished && isFinished(event.stage)) router.refresh();
  }, [finished, event.stage, router]);

  const current = STAGES.findIndex((stage) => stage === event.stage);
  const failedAt = STAGES.findIndex((stage) => stage === analysis.failed_stage);

  function phaseOf(index: number): Phase {
    if (event.stage === "complete") return "done";
    if (analysis.status === "failed") {
      return index < failedAt ? "done" : index === failedAt ? "failed" : "waiting";
    }
    if (index < current) return "done";
    if (index === current) return stale ? "waiting" : "working";
    return "waiting";
  }

  return (
    <div className="max-w-[64ch] px-3 py-3 text-[12px]">
      <h1 className="font-mono text-[13px]">
        {analysis.project && (
          <>
            <span className="text-text-muted">{analysis.project.owner}/</span>
            {analysis.project.name}
          </>
        )}
        {analysis.commit_sha && (
          <span className="ml-2 text-[11px] text-text-muted" title={analysis.commit_sha}>
            {analysis.commit_sha.slice(0, 7)}
          </span>
        )}
      </h1>

      <ol className="mt-3 border-t border-border">
        {STAGES.map((stage, index) => {
          const phase = phaseOf(index);
          return (
            <li key={stage} className="flex min-h-7 items-baseline gap-2 border-b border-border py-1.5">
              <span className="relative top-px">
                <StateGlyph phase={phase} />
              </span>
              <span className={phase === "waiting" ? "w-24 shrink-0 text-text-muted" : "w-24 shrink-0"}>{STAGE_LABEL[stage]}</span>
              {index === current && event.message && (
                <span className="min-w-0 text-text-muted">{event.message}</span>
              )}
            </li>
          );
        })}
      </ol>

      <div className="mt-3">
        {event.stage === "pending" && !stale && <p className="text-text-muted">Waiting to start.</p>}
        {event.stage === "complete" && <p>Complete.</p>}
        {analysis.status === "failed" && analysis.failed_stage && (
          <div>
            <p>Failed while {analysis.failed_stage}.</p>
            <p className="mt-1 text-text-muted">{analysis.failure}</p>
          </div>
        )}
        {stale && (
          <p className="text-text-muted">
            Unchanged for over ten minutes. This run has most likely stopped, not slowed down.
          </p>
        )}
        {connection === "unavailable" && !isFinished(event.stage) && (
          <p className="text-text-muted">Live updates couldn&apos;t connect. Reload to see the current stage.</p>
        )}
      </div>
    </div>
  );
}
