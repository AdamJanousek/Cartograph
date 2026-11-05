import { computeFan, dedupeEdges, type EdgeInput } from "@/graph/edges";
import type { EdgeKind, ParseResult } from "@/parser/types";
import { SCHEMA_VERSION } from "@/parser/types";
import { checkParseResult } from "@/parser/validate";
import { compare, folderOf } from "@/parser/walk";
import { createClient } from "@/utils/supabase/server";

// Supabase returns at most this many rows per request, so a graph is read in
// pages of it. A bounded read of one analysis, once per render, not a poll.
const PAGE = 1000;

const EDGE_KIND: Record<string, EdgeKind> = {
  import: "import",
  re_export: "re-export",
  dynamic_import: "dynamic-import",
};

/**
 * A stored analysis, back in the parser's own shape and through the parser's
 * own validator. The integrity check is what catches a graph that was only
 * partly stored: coverage says how many files were parsed, and the rows have
 * to agree.
 */
export async function getAnalysisMap(
  analysisId: string,
  analysis: { frameworks: string[]; coverage: unknown; owner: string; name: string },
): Promise<ParseResult> {
  const supabase = await createClient();

  const files = await readAll(async (from, to) => {
    const { data, error } = await supabase
      .from("files")
      .select("id, path, lines, bytes, content_hash, file_roles(role)")
      .eq("analysis_id", analysisId)
      .order("id")
      .range(from, to);
    if (error) throw new Error(`Reading files failed: ${error.message}`);
    return data;
  });

  const edgeRows = await readAll(async (from, to) => {
    const { data, error } = await supabase
      .from("edges")
      .select("source_file_id, target_file_id, kind, type_only")
      .eq("analysis_id", analysisId)
      .order("id")
      .range(from, to);
    if (error) throw new Error(`Reading connections failed: ${error.message}`);
    return data;
  });

  const pathOf = new Map(files.map((file) => [file.id, file.path]));
  const inputs: EdgeInput[] = edgeRows.map((row) => {
    const from = pathOf.get(row.source_file_id);
    const to = pathOf.get(row.target_file_id);
    const kind = EDGE_KIND[row.kind];
    if (!from || !to) throw new Error("A stored connection points at a file that wasn't stored.");
    if (!kind) throw new Error(`A stored connection has a kind the map doesn't know: ${row.kind}.`);
    return { from, to, kind, typeOnly: row.type_only };
  });
  const edges = dedupeEdges(inputs);
  const paths = files.map((file) => file.path);
  const fan = computeFan(paths, edges);

  return checkParseResult({
    schemaVersion: SCHEMA_VERSION,
    root: `${analysis.owner}/${analysis.name}`,
    frameworks: analysis.frameworks,
    files: files
      .map((file) => ({
        path: file.path,
        folder: folderOf(file.path),
        lines: file.lines,
        bytes: file.bytes,
        hash: file.content_hash,
        role: file.file_roles[0]?.role ?? null,
        fanIn: fan.get(file.path)?.fanIn ?? 0,
        fanOut: fan.get(file.path)?.fanOut ?? 0,
      }))
      .sort((a, b) => compare(a.path, b.path)),
    edges,
    coverage: analysis.coverage,
  });
}

async function readAll<T>(page: (from: number, to: number) => Promise<T[]>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const batch = await page(from, from + PAGE - 1);
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
  }
}
