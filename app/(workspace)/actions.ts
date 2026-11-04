"use server";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { parseRepositoryUrl, type Repository } from "@/pipeline/fetch";
import { runAnalysis, startAnalysis } from "@/pipeline/run";
import { createRunClient } from "@/utils/supabase/server";

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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
