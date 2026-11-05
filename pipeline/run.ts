import type { Database } from "@/types/database";
import type { Client } from "@/utils/supabase/server";
import { parseSelection, selectFiles, type EdgeKind, type ParseResult } from "../parser/index.ts";
import { fetchArchive, type Archive, type Repository } from "./fetch.ts";

type Status = Database["public"]["Enums"]["analysis_status"];
type Stage = Extract<Status, "fetching" | "selecting" | "parsing" | "storing">;

// Small enough that each insert finishes well inside the 8-second statement
// timeout Supabase gives signed-in requests.
const FILE_CHUNK = 500;
const EDGE_CHUNK = 1000;

const EDGE_KIND_COLUMN: Record<EdgeKind, string> = {
  import: "import",
  "re-export": "re_export",
  "dynamic-import": "dynamic_import",
};

/**
 * Finds or creates the one analysis for this repository in the caller's
 * organization. `existing` is true when it was already there; nothing is
 * created or reset in that case.
 */
export async function startAnalysis(
  supabase: Client,
  organization: { id: string; name: string },
  repository: Repository,
): Promise<{ analysisId: string; existing: boolean }> {
  // Clerk owns organizations; this row only exists for the others to hang off.
  const org = await supabase
    .from("organizations")
    .upsert({ id: organization.id, name: organization.name }, { onConflict: "id", ignoreDuplicates: true });
  if (org.error) throw new Error(`Recording the organization failed: ${org.error.message}`);

  const project = await supabase
    .from("projects")
    .upsert(
      { organization_id: organization.id, owner: repository.owner, name: repository.name },
      { onConflict: "organization_id,owner,name", ignoreDuplicates: true },
    );
  if (project.error) throw new Error(`Recording the repository failed: ${project.error.message}`);

  // The policy already limits this to the caller's organization, where
  // owner/name is unique.
  const found = await supabase
    .from("projects")
    .select("id")
    .eq("owner", repository.owner)
    .eq("name", repository.name)
    .single();
  if (found.error) throw new Error(`Reading the repository back failed: ${found.error.message}`);

  // The unique constraint on project_id decides, not a read beforehand, so two
  // submissions at once still end with one row.
  const created = await supabase
    .from("analyses")
    .insert({ organization_id: organization.id, project_id: found.data.id })
    .select("id")
    .single();
  if (!created.error) return { analysisId: created.data.id, existing: false };
  if (created.error.code !== "23505") throw new Error(`Creating the analysis failed: ${created.error.message}`);

  const existing = await supabase.from("analyses").select("id").eq("project_id", found.data.id).single();
  if (existing.error) throw new Error(`Reading the existing analysis failed: ${existing.error.message}`);
  return { analysisId: existing.data.id, existing: true };
}

/**
 * Fetches, selects, parses and stores. Never throws: whatever goes wrong is
 * written to the row as the stage it happened in and why. If even that write
 * fails, the row is left mid-stage and its age is what marks it as abandoned.
 */
export async function runAnalysis(supabase: Client, analysisId: string): Promise<void> {
  let stage: Stage = "fetching";
  let archive: Archive | null = null;
  try {
    const row = await supabase
      .from("analyses")
      .select("organization_id, project:projects(owner, name)")
      .eq("id", analysisId)
      .single();
    if (row.error) throw new Error(`Reading the analysis failed: ${row.error.message}`);
    const { owner, name } = row.data.project;
    const organizationId = row.data.organization_id;

    await update(supabase, analysisId, { status: stage, stage_message: `Downloading ${owner}/${name} from GitHub` });
    archive = await fetchArchive({ owner, name });

    stage = "selecting";
    await update(supabase, analysisId, {
      status: stage,
      commit_sha: archive.commitSha,
      stage_message: `Finding source files at ${archive.commitSha.slice(0, 7)}`,
    });
    const selection = selectFiles(archive.directory);

    stage = "parsing";
    const { files, skips } = selection.walk;
    await update(supabase, analysisId, {
      status: stage,
      stage_message: `Parsing ${count(files.length, "source file")}${skips.length ? `, ${skips.length} skipped` : ""}`,
    });
    const result = parseSelection(selection);

    stage = "storing";
    await update(supabase, analysisId, {
      status: stage,
      stage_message: `Storing ${count(result.files.length, "file")}, ${count(result.edges.length, "connection")} and ${count(result.routes.length, "route")}`,
    });
    await store(supabase, analysisId, organizationId, result);

    await update(supabase, analysisId, {
      status: "complete",
      stage_message: null,
      frameworks: result.frameworks,
      coverage: result.coverage,
    });
  } catch (error) {
    await recordFailure(supabase, analysisId, stage, error);
  } finally {
    await archive?.remove();
  }
}

async function store(supabase: Client, analysisId: string, organizationId: string, result: ParseResult): Promise<void> {
  // Starts from nothing, so storing twice can't collide with itself.
  await clearGraph(supabase, analysisId);

  const fileIds = new Map<string, string>();
  for (const chunk of chunks(result.files, FILE_CHUNK)) {
    const inserted = await supabase
      .from("files")
      .insert(
        chunk.map((file) => ({
          organization_id: organizationId,
          analysis_id: analysisId,
          path: file.path,
          lines: file.lines,
          bytes: file.bytes,
          content_hash: file.hash,
        })),
      )
      .select("id, path");
    if (inserted.error) throw new Error(`Storing files failed: ${inserted.error.message}`);
    for (const row of inserted.data) fileIds.set(row.path, row.id);
  }
  const idOf = (path: string): string => {
    const id = fileIds.get(path);
    if (!id) throw new Error(`Storing connections failed: ${path} was not stored as a file.`);
    return id;
  };

  const roles = result.files.flatMap((file) =>
    file.role ? [{ organization_id: organizationId, file_id: idOf(file.path), role: file.role, source: "convention" }] : [],
  );
  for (const chunk of chunks(roles, FILE_CHUNK)) {
    const inserted = await supabase.from("file_roles").insert(chunk);
    if (inserted.error) throw new Error(`Storing file roles failed: ${inserted.error.message}`);
  }

  // One row per way a file reaches another, as the table is keyed.
  const edges = result.edges.flatMap((edge) =>
    edge.kinds.map((kind) => ({
      organization_id: organizationId,
      analysis_id: analysisId,
      source_file_id: idOf(edge.from),
      target_file_id: idOf(edge.to),
      kind: EDGE_KIND_COLUMN[kind],
      type_only: edge.typeOnly,
    })),
  );
  for (const chunk of chunks(edges, EDGE_CHUNK)) {
    const inserted = await supabase.from("edges").insert(chunk);
    if (inserted.error) throw new Error(`Storing connections failed: ${inserted.error.message}`);
  }

  const routes = result.routes.map((route) => ({
    organization_id: organizationId,
    analysis_id: analysisId,
    file_id: idOf(route.file),
    method: route.method,
    pattern: route.pattern,
    line: route.line,
  }));
  for (const chunk of chunks(routes, FILE_CHUNK)) {
    const inserted = await supabase.from("routes").insert(chunk);
    if (inserted.error) throw new Error(`Storing routes failed: ${inserted.error.message}`);
  }
}

// Edges, roles and routes cascade from files.
async function clearGraph(supabase: Client, analysisId: string): Promise<void> {
  const deleted = await supabase.from("files").delete().eq("analysis_id", analysisId);
  if (deleted.error) throw new Error(`Clearing stored files failed: ${deleted.error.message}`);
}

async function recordFailure(supabase: Client, analysisId: string, stage: Stage, error: unknown): Promise<void> {
  const reason = error instanceof Error ? error.message : String(error);
  try {
    // A half-stored graph would draw as a complete-looking smaller one.
    if (stage === "storing") await clearGraph(supabase, analysisId);
    await update(supabase, analysisId, { status: "failed", failed_stage: stage, failure: reason, stage_message: null });
  } catch (writeError) {
    console.error(`Analysis ${analysisId} failed while ${stage} (${reason}) and the failure couldn't be recorded:`, writeError);
  }
}

// Reading the row back makes an update that matched nothing an error. Under
// RLS that's otherwise a silent success.
async function update(
  supabase: Client,
  analysisId: string,
  values: Database["public"]["Tables"]["analyses"]["Update"],
): Promise<void> {
  const updated = await supabase.from("analyses").update(values).eq("id", analysisId).select("id").single();
  if (updated.error) throw new Error(`Updating the analysis failed: ${updated.error.message}`);
}

function* chunks<T>(items: readonly T[], size: number): Generator<T[]> {
  for (let start = 0; start < items.length; start += size) yield items.slice(start, start + size);
}

function count(n: number, noun: string): string {
  return `${n.toLocaleString("en")} ${noun}${n === 1 ? "" : "s"}`;
}
