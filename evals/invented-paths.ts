// Usage:
//   node evals/invented-paths.ts [--limit 50] [--days 30]   check recent real explanations
//   node evals/invented-paths.ts --splice [path]       splice a made-up path into one, and check that
//
// Reads explanations from their traces, not the database: each fresh answer's
// run records the paths its prompt showed, which is the set it's checked
// against. The app already runs this check live on every fresh answer; this
// re-runs it over recent traffic, and says where to look for each failure.

import "./env.ts";
import { posix } from "node:path";
import type { Run } from "langsmith/resources";
import { tracing, traces } from "../ai/client.ts";
import { checkInventedPaths } from "../ai/invented-paths.ts";

interface Scorable {
  run: Run;
  target: string;
  body: string;
  shown: string[];
  base: string;
}

async function main(args: string[]): Promise<void> {
  const limit = Number(valueAfter(args, "--limit") ?? 50);
  const days = Number(valueAfter(args, "--days") ?? 30);
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(days) || days < 1) throw new Error("--limit and --days take whole numbers.");
  const client = traces();
  const project = tracing.on ? tracing.project : "";
  const projectId = (await client.readProject({ projectName: project })).id;

  const scorable: Scorable[] = [];
  let cached = 0;
  let unrecorded = 0;
  let seen = 0;
  for await (const run of client.runs.query({
    project_ids: [projectId],
    is_root: true,
    has_error: false,
    filter: 'or(eq(name, "explain_file"), eq(name, "explain_folder"))',
    min_start_time: new Date(Date.now() - days * 86_400_000).toISOString(),
    selects: ["ID", "NAME", "START_TIME", "TRACE_ID", "INPUTS", "OUTPUTS"],
    page_size: Math.min(limit, 100),
  })) {
    if (++seen > limit) break;
    const found = read(run);
    if (found === "cached") cached++;
    else if (found === null) unrecorded++;
    else scorable.push(found);
  }

  const skipped = [
    cached && `${cached} cache hits, scored when first written`,
    unrecorded && `${unrecorded} recorded before the check existed`,
  ].filter(Boolean);
  console.log(`${scorable.length} fresh explanations among the last ${Math.min(seen, limit)} explain runs in ${project} over ${days} days${skipped.length ? ` (also ${skipped.join("; ")})` : ""}.`);
  if (!scorable.length) {
    throw new Error("Nothing to check. Explain a file or folder that hasn't been explained before, then run this again.");
  }

  if (args.includes("--splice")) return splice(scorable[0], valueAfter(args, "--splice"));

  const failures: { item: Scorable; invented: string[] }[] = [];
  let paths = 0;
  for (const item of scorable) {
    const check = checkInventedPaths(item.body, item.shown, item.base);
    paths += check.checked.length;
    if (check.invented.length) failures.push({ item, invented: check.invented });
  }
  const clean = scorable.length - failures.length;
  console.log(`\nscore ${clean}/${scorable.length} explanations name only paths they were shown (${percent(clean, scorable.length)}), ${paths} paths checked\n`);

  for (const { item, invented } of failures) {
    console.log(`${item.run.name}  ${item.target}`);
    for (const token of invented) console.log(`  not shown: ${token}\n    “${around(item.body, token)}”`);
    const link = await client.runs.getURL(item.run.id ?? "", { project_id: projectId, trace_id: item.run.trace_id ?? item.run.id ?? "" });
    console.log(`  shown ${item.shown.length} paths; run ${link.url ?? item.run.id}\n`);
  }
}

/** Splices a made-up path into a real explanation, and shows the check catching it. */
function splice(item: Scorable, path: string | undefined): void {
  // Named like the files around it, so it's exactly the kind of path the model could plausibly have made up.
  const extension = item.shown.map((shown) => posix.extname(shown)).find(Boolean) ?? ".ts";
  const fake = path ?? posix.join(item.base, `ledger-reconciler${extension}`);
  if (item.shown.includes(fake)) throw new Error(`${fake} was shown to the model, so it isn't made up. Pick another path.`);
  const before = checkInventedPaths(item.body, item.shown, item.base);
  const [first, ...rest] = item.body.split("\n\n");
  const spliced = [`${first} It also hands its results to \`${fake}\`.`, ...rest].join("\n\n");
  const after = checkInventedPaths(spliced, item.shown, item.base);

  console.log(`\n${item.run.name}  ${item.target}`);
  console.log(`  as written:     ${before.invented.length ? `invented ${before.invented.join(", ")}` : "clean"}`);
  console.log(`  spliced in:     \`${fake}\``);
  console.log(`  after splicing: ${after.invented.length ? `invented ${after.invented.join(", ")}` : "clean"}`);
  const caught = after.invented.includes(fake);
  console.log(caught ? "\ncaught" : "\nNOT CAUGHT");
  if (!caught) process.exitCode = 1;
}

function read(run: Run): Scorable | "cached" | null {
  const outputs = run.outputs;
  const explanation: unknown = outputs?.explanation;
  if (!isRecord(explanation) || typeof explanation.body !== "string") return null;
  if (explanation.cached === true) return "cached";
  const shown: unknown = outputs?.shown;
  const base: unknown = outputs?.base;
  if (!Array.isArray(shown) || !shown.every((path) => typeof path === "string") || typeof base !== "string") return null;
  const target = run.inputs?.path ?? run.inputs?.id;
  return { run, target: typeof target === "string" ? target : "?", body: explanation.body, shown, base };
}

function around(text: string, token: string): string {
  const at = text.indexOf(token);
  const start = Math.max(0, at - 60);
  const end = Math.min(text.length, at + token.length + 60);
  return `${start ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ")}${end < text.length ? "…" : ""}`;
}

function percent(part: number, whole: number): string {
  return `${((100 * part) / whole).toFixed(1)}%`;
}

function valueAfter(args: string[], flag: string): string | undefined {
  const next = args[args.indexOf(flag) + 1];
  return args.includes(flag) && next && !next.startsWith("--") ? next : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
