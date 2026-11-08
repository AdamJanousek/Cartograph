import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Client } from "@/utils/supabase/server";
import type { Edge, FileNode } from "../parser/types.ts";
import { traceable } from "langsmith/traceable";
import { MODEL, model, textOf, traceAs } from "./client.ts";

// Roles for the files no adapter could identify. The model picks from a fixed
// list of roles that change nothing structural: page, route and controller
// decide the route table and the entry-point colouring, and only convention
// assigns those. The database refuses them from the model as well.

export const MODEL_ROLES = ["service", "repository", "model", "util", "config", "component", "hook"] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

const BATCH = 25;
const CONCURRENT_BATCHES = 4;
/** How much of each file the model sees: its opening, which is where imports and exports sit. */
const EXCERPT_LINES = 60;
const EXCERPT_CHARS = 3000;
/** Neighbours listed per file. A hint for a label, not the full picture an explanation gets. */
const NEIGHBOURS = 15;

export interface LabelSummary {
  /** Files asked about: every file the adapters left without a role. */
  files: number;
  /** Files given a role. The rest the model said it couldn't tell. */
  labelled: number;
}

interface Labelling {
  supabase: Client;
  analysisId: string;
  organizationId: string;
  /** The checked-out archive, still on disk during the run. */
  directory: string;
  frameworks: readonly string[];
  files: readonly FileNode[];
  edges: readonly Edge[];
  fileIds: ReadonlyMap<string, string>;
}

export async function labelUnidentified(run: Labelling): Promise<LabelSummary> {
  const unidentified = run.files.filter((file) => file.role === null);
  const imports = new Map<string, string[]>();
  const importers = new Map<string, string[]>();
  for (const edge of run.edges) {
    (imports.get(edge.from) ?? imports.set(edge.from, []).get(edge.from)!).push(edge.to);
    (importers.get(edge.to) ?? importers.set(edge.to, []).get(edge.to)!).push(edge.from);
  }

  const labelBatch = traceable(async ({ paths }: { paths: string[] }) => {
    const batch = paths.map((path) => unidentified.find((file) => file.path === path)!);

    // The cache read, inside the trace: a fully cached batch is a run with no
    // model call in it.
    const cached = await run.supabase
      .from("role_labels")
      .select("path, content_hash, role")
      .eq("analysis_id", run.analysisId)
      .eq("model", MODEL.label)
      .in("path", paths);
    if (cached.error) throw new Error(`Reading cached labels failed: ${cached.error.message}`);
    const hits = new Map<string, ModelRole | null>();
    for (const row of cached.data) {
      const file = batch.find((f) => f.path === row.path);
      if (file && file.hash === row.content_hash) hits.set(row.path, isModelRole(row.role) ? row.role : null);
    }

    const misses = batch.filter((file) => !hits.has(file.path));
    const answered = misses.length ? await ask(misses) : new Map<string, ModelRole | null>();
    if (answered.size) {
      const stored = await run.supabase.from("role_labels").upsert(
        [...answered].map(([path, role]) => ({
          organization_id: run.organizationId,
          analysis_id: run.analysisId,
          path,
          content_hash: misses.find((file) => file.path === path)!.hash,
          model: MODEL.label,
          role,
        })),
        { onConflict: "analysis_id,path,content_hash,model", ignoreDuplicates: true },
      );
      if (stored.error) throw new Error(`Caching labels failed: ${stored.error.message}`);
    }
    return { cached: hits.size, asked: misses.length, labels: [...hits, ...answered] };
  }, traceAs("label_files"));

  async function ask(files: readonly FileNode[]): Promise<Map<string, ModelRole | null>> {
    const described = await Promise.all(
      files.map(async (file) => {
        const source = await readFile(join(run.directory, file.path), "utf8");
        const excerpt = source.split("\n").slice(0, EXCERPT_LINES).join("\n").slice(0, EXCERPT_CHARS);
        const list = (paths: string[] | undefined) =>
          paths?.length ? paths.slice(0, NEIGHBOURS).join(", ") + (paths.length > NEIGHBOURS ? ` and ${paths.length - NEIGHBOURS} more` : "") : "none";
        return [
          `### ${file.path}`,
          `imports: ${list(imports.get(file.path))}`,
          `imported by: ${list(importers.get(file.path))}`,
          "```",
          excerpt,
          "```",
        ].join("\n");
      }),
    );

    // One line per file rather than JSON: this endpoint doesn't enforce a
    // schema for this model, and the line format comes back reliably.
    const completion = await model().chat.completions.create({
      model: MODEL.label,
      temperature: 0,
      max_tokens: 40 * files.length + 100,
      messages: [
        {
          role: "system",
          content: [
            "You label source files in a TypeScript or JavaScript repository by the role each plays.",
            `Choose exactly one of: ${MODEL_ROLES.join(", ")}, or none when the excerpt doesn't make the role clear; a wrong label is worse than none.`,
            "service: business logic other code calls. repository: data access. model: data shapes or ORM models. util: small general-purpose helpers. config: configuration values or setup. component: a UI component. hook: a React hook.",
            "Answer with one line per file and nothing else, using each file's exact path, in the form:",
            "<path> => <role>",
          ].join("\n"),
        },
        {
          role: "user",
          content: `Frameworks detected: ${run.frameworks.join(", ") || "none"}.\n\n${described.join("\n\n")}`,
        },
      ],
    });

    const answered = new Map<string, ModelRole | null>();
    const asked = new Set(files.map((file) => file.path));
    // Checked rather than trusted: an unasked path or an unlisted role is
    // dropped, and a file left out stays unidentified and uncached.
    for (const line of textOf(completion).split("\n")) {
      const match = /^\s*[-*]?\s*`?(.+?)`?\s*=>\s*`?([a-z]+)`?\s*$/i.exec(line);
      if (!match) continue;
      const [, path, role] = match;
      const answer = role.toLowerCase();
      if (!asked.has(path)) continue;
      if (answer === "none") answered.set(path, null);
      else if (isModelRole(answer)) answered.set(path, answer);
    }
    return answered;
  }

  const labels = new Map<string, ModelRole>();
  const batches = chunk(unidentified.map((file) => file.path), BATCH);
  for (const group of chunk(batches, CONCURRENT_BATCHES)) {
    const results = await Promise.all(group.map((paths) => labelBatch({ paths })));
    for (const result of results) {
      for (const [path, role] of result.labels) if (role) labels.set(path, role);
    }
  }

  const rows = [...labels].map(([path, role]) => {
    const fileId = run.fileIds.get(path);
    if (!fileId) throw new Error(`Storing labels failed: ${path} was not stored as a file.`);
    return { organization_id: run.organizationId, file_id: fileId, role, source: "model" };
  });
  for (const group of chunk(rows, 500)) {
    const inserted = await run.supabase.from("file_roles").insert(group);
    if (inserted.error) throw new Error(`Storing labels failed: ${inserted.error.message}`);
  }
  return { files: unidentified.length, labelled: labels.size };
}

export function isModelRole(value: unknown): value is ModelRole {
  return typeof value === "string" && (MODEL_ROLES as readonly string[]).includes(value);
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) out.push(items.slice(start, start + size));
  return out;
}
