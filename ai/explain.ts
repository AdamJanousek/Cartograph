import { createHash } from "node:crypto";
import { fold } from "@/graph/fold";
import { fetchFileAt } from "@/pipeline/fetch";
import type { Edge, FileNode } from "@/parser/types";
import { getAnalysis } from "@/utils/queries/analyses";
import { getAnalysisMap } from "@/utils/queries/analysis-map";
import { createClient } from "@/utils/supabase/server";
import { traceable } from "langsmith/traceable";
import { MODEL, model, textOf, traceAs } from "./client";

// Explaining a file or a folded folder. The model is handed the parser's facts
// (every neighbour, every member, every connection) and explains them. It is
// never asked whether two files are connected, and it never walks the graph:
// every path in the prompt was put there by this code.

/** Characters of a file's source the model sees. Past this it's told the rest was cut. */
const SOURCE_CHARS = 40_000;

// Exactly three pieces of formatting, because the pane renders exactly three.
// Forbidding all formatting doesn't survive contact: models emit it anyway and
// it shows up as raw backticks. Headings are out because the pane is narrow.
const FORMAT = [
  "Write plain prose: two or three short paragraphs, and at most one short bulleted list.",
  "The only formatting allowed is `inline code`, **bold**, and bullets starting with \"- \". No headings, no numbered lists, no code blocks, no links, no tables.",
  "Write every file or folder you mention as its full repository path in inline code, exactly as given below. Mention only paths that appear below.",
];

const STANCE = [
  "You explain a codebase to a developer reading it for the first time. You don't review it: no judgements of quality, no suggestions, no risks or issues.",
  "The connections listed below come from a parser and are complete. Don't claim any connection that isn't listed, and don't speculate about files you weren't shown.",
];

export type ExplainTarget = { kind: "file"; path: string } | { kind: "folder"; id: string };

export interface Explanation {
  body: string;
  model: string;
  /** True when this came from the cache: the trace has no model call in it. */
  cached: boolean;
}

// Only ids go in, so that's all a trace records as input. Everything else is
// read inside, under the caller's organization policy.
export async function explain(analysisId: string, target: ExplainTarget): Promise<Explanation> {
  return target.kind === "file" ? explainFile({ analysisId, path: target.path }) : explainFolder({ analysisId, id: target.id });
}

const explainFile = traceable(
  async (input: { analysisId: string; path: string }): Promise<Explanation> => {
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
  if (hit !== null) return { body: hit, model: MODEL.explain, cached: true };

  const map = await mapOf(input.analysisId);
  const file = map.byPath.get(input.path)!;
  // The bytes that were parsed, checked against the hash that was stored. If
  // GitHub hands back anything else, nothing is explained.
  const bytes = await fetchFileAt(map.repository, map.commitSha, input.path);
  if (!bytes) throw new Error(`GitHub no longer serves ${input.path} at the analysed commit.`);
  if (sha256(bytes) !== hash) throw new Error(`GitHub's copy of ${input.path} doesn't match the one that was parsed.`);
  const source = bytes.toString("utf8");

  const imports = map.edges.filter((edge) => edge.from === input.path);
  const importers = map.edges.filter((edge) => edge.to === input.path);
  const neighbour = (path: string, edge: Edge) =>
    `- \`${path}\`${roleOf(map.byPath.get(path))} via ${edge.kinds.join(", ")}${edge.typeOnly ? ", types only" : ""}`;

  const prompt = [
    `Repository: ${map.repository.owner}/${map.repository.name}. Frameworks: ${map.frameworks.join(", ") || "none detected"}.`,
    `File: \`${file.path}\`${roleOf(file)}, ${file.lines} lines.`,
    "",
    `It imports ${imports.length} file${imports.length === 1 ? "" : "s"} in this repository:`,
    ...(imports.length ? imports.map((edge) => neighbour(edge.to, edge)) : ["(none)"]),
    "",
    `It is imported by ${importers.length} file${importers.length === 1 ? "" : "s"}:`,
    ...(importers.length ? importers.map((edge) => neighbour(edge.from, edge)) : ["(none)"]),
    "",
    "Its source:",
    "```",
    source.slice(0, SOURCE_CHARS),
    "```",
    source.length > SOURCE_CHARS ? `(The source was cut at ${SOURCE_CHARS} characters; it continues.)` : "",
    "",
    "Explain what this file does and the part it plays among the files around it: what it gives the files that import it, and what it relies on from the ones it imports.",
  ].join("\n");

  const body = await ask(prompt);
  await writeCache(map, input.path, hash, body);
  return { body, model: MODEL.explain, cached: false };
},
  traceAs("explain_file"),
);

const explainFolder = traceable(
  async (input: { analysisId: string; id: string }): Promise<Explanation> => {
  const map = await mapOf(input.analysisId);
  const node = map.folding.nodes.find((n) => n.id === input.id);
  if (!node) throw new Error(`${input.id} isn't a folder on this map.`);
  // A folder's content is its files' content: any file in it changing, or
  // joining or leaving it, is a different folder.
  const hash = sha256(Buffer.from(node.files.map((path) => `${path}\0${map.byPath.get(path)!.hash}\n`).join("")));

  const hit = await readCache(input.analysisId, input.id, hash);
  if (hit !== null) return { body: hit, model: MODEL.explain, cached: true };

  const inside = new Set(node.files);
  const incoming = map.edges.filter((edge) => !inside.has(edge.from) && inside.has(edge.to));
  const outgoing = map.edges.filter((edge) => inside.has(edge.from) && !inside.has(edge.to));
  const by = (edges: Edge[], key: "from" | "to") => {
    const grouped = new Map<string, string[]>();
    for (const edge of edges) {
      const other = key === "to" ? edge.from : edge.to;
      (grouped.get(edge[key]) ?? grouped.set(edge[key], []).get(edge[key])!).push(other);
    }
    return [...grouped].sort((a, b) => b[1].length - a[1].length);
  };
  const label = node.id === "." ? "the repository root" : `\`${node.id}\``;

  const prompt = [
    `Repository: ${map.repository.owner}/${map.repository.name}. Frameworks: ${map.frameworks.join(", ") || "none detected"}.`,
    `Folder: ${label}, shown on the map as one box holding ${node.files.length} files (subfolders too small to draw on their own are folded into it).`,
    "",
    "Its files:",
    ...node.files.map((path) => {
      const file = map.byPath.get(path)!;
      return `- \`${path}\`${roleOf(file)}, ${file.lines} lines, imported by ${file.fanIn}, imports ${file.fanOut}`;
    }),
    "",
    `${incoming.length} connections point into it from outside, from ${new Set(incoming.map((e) => e.from)).size} files. By the file inside they reach:`,
    ...(incoming.length ? by(incoming, "to").map(([to, from]) => `- \`${to}\` ← ${from.map((p) => `\`${p}\``).join(", ")}`) : ["(none)"]),
    "",
    `${outgoing.length} connections leave it. By the file inside they start from:`,
    ...(outgoing.length ? by(outgoing, "from").map(([from, to]) => `- \`${from}\` → ${to.map((p) => `\`${p}\``).join(", ")}`) : ["(none)"]),
    "",
    "Explain this folder as a whole, not any one file in it: what it holds, what part it plays in the repository, and why the files that point at it depend on it.",
  ].join("\n");

  const body = await ask(prompt);
  await writeCache(map, input.id, hash, body);
  return { body, model: MODEL.explain, cached: false };
},
  traceAs("explain_folder"),
);

async function ask(prompt: string): Promise<string> {
  const completion = await model().chat.completions.create({
    model: MODEL.explain,
    max_tokens: 1200,
    messages: [
      { role: "system", content: [...STANCE, ...FORMAT].join("\n") },
      { role: "user", content: prompt },
    ],
  });
  return textOf(completion);
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

function roleOf(file: FileNode | undefined): string {
  return file?.role ? ` (${file.role})` : "";
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
