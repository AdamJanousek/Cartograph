"use server";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { flushTraces } from "@/ai/client";
import { type Explanation, explain, type ExplainTarget } from "@/ai/explain";
import { parseRepositoryUrl, type Repository } from "@/pipeline/fetch";
import { checkFreshness, type Freshness } from "@/pipeline/freshness";
import { runAnalysis, startAnalysis } from "@/pipeline/run";
import { getAnalysis } from "@/utils/queries/analyses";
import { createClient, createRunClient } from "@/utils/supabase/server";

export interface AnalyseState {
  error: string | null;
  input: string;
}

export async function analyseRepository(_previous: AnalyseState, form: FormData): Promise<AnalyseState> {
  const field = form.get("url");
  const input = typeof field === "string" ? field : "";

  let repository: Repository;
  try {
    repository = parseRepositoryUrl(input);
  } catch (error) {
    return { error: messageOf(error), input };
  }

  const { orgId, sessionClaims } = await auth();
  if (!orgId) return { error: "Choose an organization first. Every analysis belongs to one.", input };

  // Minted here, inside the request, because the run that uses it continues
  // after the response has gone.
  const supabase = await createRunClient();
  let started: Awaited<ReturnType<typeof startAnalysis>>;
  try {
    started = await startAnalysis(supabase, { id: orgId, name: sessionClaims?.org_name ?? orgId }, repository);
  } catch (error) {
    return { error: messageOf(error), input };
  }

  // An existing analysis is only shown, never restarted by pasting its URL.
  if (!started.existing) after(() => runAnalysis(supabase, started.analysisId));
  redirect(`/analyses/${started.analysisId}`);
}

export type ExplainOutcome =
  | { ok: true; explanation: Explanation; freshness: Freshness }
  | { ok: false; error: string; freshness: Freshness | null };

/** Explains a file or folded folder, and says whether the repository has moved on since. */
export async function explainTarget(analysisId: string, target: ExplainTarget): Promise<ExplainOutcome> {
  // Arguments to a server action arrive from the network.
  const valid =
    typeof analysisId === "string" &&
    ((target?.kind === "file" && typeof target.path === "string") ||
      (target?.kind === "folder" && typeof target.id === "string"));
  if (!valid) return { ok: false, error: "Nothing to explain.", freshness: null };

  // Runs reach LangSmith in the background; this makes sure they're sent
  // even if the process is about to go idle.
  after(() => flushTraces().catch((error: unknown) => console.error("Sending traces to LangSmith failed:", error)));

  const [explained, freshness] = await Promise.all([
    explain(analysisId, target).then(
      (explanation) => ({ ok: true as const, explanation }),
      (error: unknown) => ({ ok: false as const, error: messageOf(error) }),
    ),
    freshnessOf(analysisId, target),
  ]);
  return explained.ok
    ? { ok: true, explanation: explained.explanation, freshness }
    : { ok: false, error: explained.error, freshness };
}

async function freshnessOf(analysisId: string, target: ExplainTarget): Promise<Freshness> {
  const found = await getAnalysis(analysisId);
  const analysis = found?.analysis;
  if (!analysis?.project || !analysis.commit_sha) return { state: "unknown", reason: "The analysis has no commit recorded." };
  let file: { path: string; hash: string } | null = null;
  if (target.kind === "file") {
    const supabase = await createClient();
    const row = await supabase
      .from("files")
      .select("content_hash")
      .eq("analysis_id", analysisId)
      .eq("path", target.path)
      .maybeSingle();
    if (row.error || !row.data) return { state: "unknown", reason: `${target.path} isn't in this analysis.` };
    file = { path: target.path, hash: row.data.content_hash };
  }
  return checkFreshness(analysis.project, analysis.commit_sha, file);
}

/**
 * Runs a finished analysis again, on whatever the repository is now. Explanations
 * and labels are kept: they're keyed on content, so anything unchanged is
 * still a cache hit.
 */
export async function reanalyse(analysisId: string): Promise<void> {
  if (typeof analysisId !== "string") return;
  const { orgId } = await auth();
  if (!orgId) return;
  const supabase = await createRunClient();
  // Claimed by the update itself: only a finished run moves to pending, so two
  // clicks start one run, and another organization's row matches nothing.
  const claimed = await supabase
    .from("analyses")
    .update({ status: "pending", stage_message: null, failed_stage: null, failure: null })
    .eq("id", analysisId)
    .in("status", ["complete", "failed"])
    .select("id");
  if (claimed.error) throw new Error(`Starting the re-analysis failed: ${claimed.error.message}`);
  if (claimed.data.length === 1) after(() => runAnalysis(supabase, analysisId));
  redirect(`/analyses/${analysisId}`);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
