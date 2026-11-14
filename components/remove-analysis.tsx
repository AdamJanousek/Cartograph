"use client";

import { useEffect, useState, useTransition } from "react";
import { removeAnalysis } from "@/app/(workspace)/actions";

// Two clicks: the first arms it, the second removes. Moving away disarms it,
// so a stray click can't throw away an analysis.
export function RemoveAnalysis({ analysisId, label }: { analysisId: string; label: string }) {
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <button
      type="button"
      disabled={pending}
      aria-label={armed ? `Confirm removing ${label}` : `Remove ${label}`}
      title={error ?? (armed ? "Removes the analysis and everything stored for it" : undefined)}
      onBlur={() => setArmed(false)}
      onClick={() => {
        setError(null);
        if (!armed) return setArmed(true);
        start(async () => {
          const result = await removeAnalysis(analysisId);
          setArmed(false);
          if (result.error) setError(result.error);
        });
      }}
      className={
        "h-5 cursor-pointer rounded-[3px] px-1.5 text-[11px] disabled:cursor-default disabled:opacity-60 " +
        (armed || error
          ? "border border-accent text-accent"
          : "text-text-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-text")
      }
    >
      {pending ? "Removing…" : error ? "Failed" : armed ? "Confirm" : "Remove"}
    </button>
  );
}
