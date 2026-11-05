import { createClient } from "@/utils/supabase/server";

export const LIST_LIMIT = 100;

// No organization filter here on purpose. The policy reads the organization
// off the token, so switching organization changes the result of this exact
// query. A row from another organization showing up is a policy bug.
export async function listAnalyses() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("analyses")
    .select("id, status, commit_sha, updated_at, project:projects(owner, name)")
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);

  if (error) throw new Error(`Listing analyses failed: ${error.message}`);
  // When the rows were read, so relative times are measured from the data
  // rather than from whenever a component happens to render.
  return { analyses: data, readAt: Date.now() };
}

export type AnalysisListItem = Awaited<
  ReturnType<typeof listAnalyses>
>["analyses"][number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Null when the analysis doesn't exist or belongs to another organization: the
// policy makes those the same thing, and so does this.
export async function getAnalysis(id: string) {
  if (!UUID.test(id)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("analyses")
    .select(
      "id, status, stage_message, failed_stage, failure, commit_sha, updated_at, frameworks, coverage, project:projects(owner, name)",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Reading the analysis failed: ${error.message}`);
  return data && { analysis: data, readAt: Date.now() };
}

export type AnalysisDetail = NonNullable<
  Awaited<ReturnType<typeof getAnalysis>>
>["analysis"];
