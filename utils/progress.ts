import type { AnalysisStatus } from "@/types/database";

/** The stages a run moves through, in order. */
export const STAGES = ["fetching", "selecting", "parsing", "storing"] as const satisfies readonly AnalysisStatus[];

export const STAGE_LABEL: Record<(typeof STAGES)[number], string> = {
  fetching: "Fetch archive",
  selecting: "Select files",
  parsing: "Parse imports",
  storing: "Store map",
};

export function isFinished(status: AnalysisStatus): boolean {
  return status === "complete" || status === "failed";
}

// A run writes with a token that expires ten minutes after it starts, so a row
// unfinished this long after its last change can't be working any more. There
// is no queue or timeout to say so; this is the only thing that does.
export const STALE_AFTER_MS = 10 * 60 * 1000;

export function isStale(status: AnalysisStatus, updatedAt: string, now: number): boolean {
  return !isFinished(status) && now - Date.parse(updatedAt) > STALE_AFTER_MS;
}

/** What the database publishes on `analysis:<id>` when a run moves. */
export interface StageEvent {
  stage: AnalysisStatus;
  message: string | null;
}

export function channelFor(analysisId: string): string {
  return `analysis:${analysisId}`;
}

// The payload comes off a socket, so its shape is checked rather than assumed.
export function readStageEvent(payload: Record<string, unknown>): StageEvent | null {
  const { stage, message } = payload;
  if (!isStatus(stage)) return null;
  if (message !== null && typeof message !== "string") return null;
  return { stage, message };
}

const STATUS: Record<AnalysisStatus, true> = {
  pending: true,
  fetching: true,
  selecting: true,
  parsing: true,
  storing: true,
  complete: true,
  failed: true,
};

function isStatus(value: unknown): value is AnalysisStatus {
  return typeof value === "string" && Object.hasOwn(STATUS, value);
}
