import { createHash } from "node:crypto";
import { fold } from "@/graph/fold";
import { fetchFileAt } from "@/pipeline/fetch";
import { getAnalysis } from "@/utils/queries/analyses";
import { getAnalysisMap } from "@/utils/queries/analysis-map";
import { createClient } from "@/utils/supabase/server";
import { getCurrentRunTree, traceable } from "langsmith/traceable";
import { MODEL, recordFeedback, traceAs } from "./client";
import { completeExplanation, filePrompt, folderPrompt, type Prompt } from "./explain-prompt";
import { checkInventedPaths, INVENTED_PATHS_KEY, type PathCheck } from "./invented-paths";

// Explaining a file or a folded folder. The model is handed the parser's facts
// (every neighbour, every member, every connection) and explains them. It is
// never asked whether two files are connected, and it never walks the graph:
// every path in the prompt was put there by this code.

export type ExplainTarget = { kind: "file"; path: string } | { kind: "folder"; id: string };

export interface Explanation {
  body: string;
  model: string;
  /** True when this came from the cache: the trace has no model call in it. */
  cached: boolean;
}

/**
 * What a traced run records. A fresh answer also records the paths it was
 * shown and what the invented-path check made of it, so the check can be
 * re-run later from the trace alone. A cached answer was scored when it was
 * written.
 */
interface Traced {
  explanation: Explanation;
  shown?: string[];
  base?: string;
  check?: PathCheck;
}

// Only ids go in, so that's all a trace records as input. Everything else is
// read inside, under the caller's organization policy.
export async function explain(analysisId: string, target: ExplainTarget): Promise<Explanation> {
  const traced = target.kind === "file" ? await explainFile({ analysisId, path: target.path }) : await explainFolder({ analysisId, id: target.id });
  return traced.explanation;
}

const explainFile = traceable(
  async (input: { analysisId: string; path: string }): Promise<Traced> => {
    const supabase = await createClient();
    const row = await supabase
      .from("files")
      .select("content_hash")
      .eq("analysis_id", input.analysisId)
      .eq("path", input.path)
      .maybeSingle();
    if (row.error) throw new Error(`Reading the file failed: ${row.error.message}`);
    if (!row.data) throw new Error(`${input.path} isn't in this analysis.`);
    const hash = row.data.content_hash;

    const hit = await readCache(input.analysisId, input.path, hash);
    if (hit !== null) return { explanation: { body: hit, model: MODEL.explain, cached: true } };

    const map = await mapOf(input.analysisId);
    // The bytes that were parsed, checked against the hash that was stored. If
    // GitHub hands back anything else, nothing is explained.
    const bytes = await fetchFileAt(map.repository, map.commitSha, input.path);
    if (!bytes) throw new Error(`GitHub no longer serves ${input.path} at the analysed commit.`);
    if (sha256(bytes) !== hash) throw new Error(`GitHub's copy of ${input.path} doesn't match the one that was parsed.`);

    const prompt = filePrompt(map, input.path, bytes.toString("utf8"));
    const body = await completeExplanation(prompt.user);
    await writeCache(map, input.path, hash, body);
    return scored(prompt, body);
  },
  traceAs("explain_file"),
);

const explainFolder = traceable(
  async (input: { analysisId: string; id: string }): Promise<Traced> => {
    const map = await mapOf(input.analysisId);
    const node = map.folding.nodes.find((n) => n.id === input.id);
    if (!node) throw new Error(`${input.id} isn't a folder on this map.`);
    // A folder's content is its files' content: any file in it changing, or
    // joining or leaving it, is a different folder.
    const hash = sha256(Buffer.from(node.files.map((path) => `${path}\0${map.byPath.get(path)!.hash}\n`).join("")));

    const hit = await readCache(input.analysisId, input.id, hash);
    if (hit !== null) return { explanation: { body: hit, model: MODEL.explain, cached: true } };

    const prompt = folderPrompt(map, node);
    const body = await completeExplanation(prompt.user);
    await writeCache(map, input.id, hash, body);
    return scored(prompt, body);
  },
  traceAs("explain_folder"),
);

// The live evaluator: every fresh answer is checked as it's written, and the
// result lands on its run as feedback, next to the run itself.
function scored(prompt: Prompt, body: string): Traced {
  const check = checkInventedPaths(body, prompt.shown, prompt.base);
  recordFeedback(getCurrentRunTree(true), {
    key: INVENTED_PATHS_KEY,
    score: check.invented.length ? 0 : 1,
    comment: check.invented.length ? `Not shown to the model: ${check.invented.join(", ")}` : `${check.checked.length} paths, all shown`,
  });
  return { explanation: { body, model: MODEL.explain, cached: false }, shown: prompt.shown, base: prompt.base, check };
}

type MapOf = Awaited<ReturnType<typeof mapOf>>;

async function mapOf(analysisId: string) {
  const found = await getAnalysis(analysisId);
  const analysis = found?.analysis;
  if (!analysis?.project || !analysis.commit_sha || analysis.status !== "complete") {
    throw new Error("This analysis isn't complete, so there's nothing to explain yet.");
  }
  const repository = { owner: analysis.project.owner, name: analysis.project.name };
  const result = await getAnalysisMap(analysisId, { ...repository, frameworks: analysis.frameworks, coverage: analysis.coverage });
  return {
    analysisId,
    organizationId: analysis.organization_id,
    commitSha: analysis.commit_sha,
    repository,
    frameworks: result.frameworks,
    edges: result.edges,
    byPath: new Map(result.files.map((file) => [file.path, file])),
    // The same pure fold the browser draws, so a folder id means the same box.
    folding: fold(result.files),
  };
}

async function readCache(analysisId: string, path: string, hash: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("explanations")
    .select("body")
    .eq("analysis_id", analysisId)
    .eq("path", path)
    .eq("content_hash", hash)
    .eq("model", MODEL.explain)
    .maybeSingle();
  if (error) throw new Error(`Reading the cached explanation failed: ${error.message}`);
  return data?.body ?? null;
}

async function writeCache(context: MapOf, path: string, hash: string, body: string): Promise<void> {
  const supabase = await createClient();
  // Two clicks racing both ask; the first answer stored is the one kept.
  const { error } = await supabase.from("explanations").upsert(
    { organization_id: context.organizationId, analysis_id: context.analysisId, path, content_hash: hash, model: MODEL.explain, body },
    { onConflict: "analysis_id,path,content_hash,model", ignoreDuplicates: true },
  );
  if (error) throw new Error(`Caching the explanation failed: ${error.message}`);
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
