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
