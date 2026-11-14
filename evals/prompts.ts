// Usage:
//   node evals/prompts.ts [--rebuild]
//
// The shipped explanation prompt and the retired one, run over the same
// dataset as two experiments, scored the same two ways:
//
// - no_invented_paths: the invented-path check. Deterministic, exact.
// - specificity: a model's 1–5 rating of how specific and useful the
//   explanation is. There's no exact answer to that, so a model has to judge
//   it, and the number is that model's opinion, not a measurement. It's
//   labelled as such wherever it's printed.
//
// Both versions run on the same explainer model and are judged by the same
// judge, so the judge's leanings apply to both sides; the gap between them is
// what to read, more than either score.

import "./env.ts";
import type { ExampleCreate } from "langsmith/schemas";
import { evaluate, type EvaluationResult } from "langsmith/evaluation";
import { MODEL, model, textOf, traces } from "../ai/client.ts";
import { completeExplanation, EXPLAIN_SYSTEM, filePrompt, folderPrompt } from "../ai/explain-prompt.ts";
import { checkInventedPaths, INVENTED_PATHS_KEY } from "../ai/invented-paths.ts";
import { fold } from "../graph/fold.ts";
import { ensureDataset } from "./dataset.ts";
import { RETIRED_EXPLAIN_SYSTEM } from "./retired-prompt.ts";
import { spread, withParsed } from "./repositories.ts";

const DATASET = "cartograph-explanations";
const REPOSITORIES = ["hagopj13/node-express-boilerplate", "brocoders/nestjs-boilerplate"];
const FILES_PER_REPOSITORY = 6;
const FOLDERS_PER_REPOSITORY = 3;

/** Pinned exactly, like every model. Larger than the explainer, and only ever a judge. */
const JUDGE = "nvidia/nemotron-3-ultra-550b-a55b";
const SPECIFICITY_KEY = "specificity";

const VERSIONS = [
  { name: "current", system: EXPLAIN_SYSTEM },
  { name: "retired", system: RETIRED_EXPLAIN_SYSTEM },
] as const;

async function build(): Promise<ExampleCreate[]> {
  const examples: ExampleCreate[] = [];
  for (const repository of REPOSITORIES) {
    await withParsed(repository, async ({ label, result, facts, read }) => {
      // The files with the most neighbours, where explaining "the part it
      // plays among the files around it" has the most to say. Tests aside.
      const ranked = result.files
        .filter((file) => file.role !== "test" && file.fanIn + file.fanOut > 0)
        .sort((a, b) => b.fanIn + b.fanOut - (a.fanIn + a.fanOut) || a.path.localeCompare(b.path));
      for (const file of spread(ranked.slice(0, FILES_PER_REPOSITORY * 3), FILES_PER_REPOSITORY)) {
        const prompt = filePrompt(facts, file.path, await read(file.path));
        examples.push({ inputs: { kind: "file", target: file.path, ...prompt }, metadata: { repository: label } });
      }
      const folders = fold(result.files)
        .nodes.filter((node) => node.files.length >= 3)
        .sort((a, b) => b.files.length - a.files.length || a.id.localeCompare(b.id));
      for (const node of folders.slice(0, FOLDERS_PER_REPOSITORY)) {
        const prompt = folderPrompt(facts, node);
        examples.push({ inputs: { kind: "folder", target: node.id, ...prompt }, metadata: { repository: label } });
      }
      console.log(`  ${label}: ${examples.length} examples so far`);
    });
  }
  return examples;
}

interface Example {
  user: string;
  shown: string[];
  base: string;
}

function asExample(inputs: Record<string, unknown>): Example {
  const { user, shown, base } = inputs;
  if (typeof user !== "string" || typeof base !== "string" || !Array.isArray(shown)) throw new Error("Example inputs aren't a prompt.");
  return { user, base, shown: shown.map(String) };
}

function inventedPaths({ inputs, outputs }: { inputs: Record<string, unknown>; outputs: Record<string, unknown> }): EvaluationResult {
  const { shown, base } = asExample(inputs);
  const check = checkInventedPaths(String(outputs.body ?? ""), shown, base);
  return {
    key: INVENTED_PATHS_KEY,
    score: check.invented.length ? 0 : 1,
    comment: check.invented.length ? `Not shown: ${check.invented.join(", ")}` : `${check.checked.length} paths, all shown`,
  };
}

async function specificity({ inputs, outputs }: { inputs: Record<string, unknown>; outputs: Record<string, unknown> }): Promise<EvaluationResult> {
  const { user } = asExample(inputs);
  const completion = await model().chat.completions.create({
    model: JUDGE,
    temperature: 0,
    // Room to reason before rating: this judge thinks out loud, and a rating
    // cut off by the limit is a missing rating.
    max_tokens: 2000,
    messages: [
      {
        role: "system",
        content: [
          "You rate explanations of code for a developer reading a codebase for the first time.",
          "You'll get the facts the explanation was written from, then the explanation.",
          "Rate how specific and useful it is, from 1 to 5:",
          "5: says concretely what this code does and how it relates to the named files around it; a developer learns things they'd otherwise have to read the code for.",
          "3: correct but partly generic; some sentences could describe many files.",
          "1: generic or vague; could describe almost any file, or mostly restates names.",
          "Judge specificity and usefulness only, not style or formatting.",
          "Give one or two sentences of reasoning, then finish with a line of exactly this form:",
          "Rating: <1-5>",
        ].join("\n"),
      },
      { role: "user", content: `FACTS\n${user}\n\nEXPLANATION\n${String(outputs.body ?? "")}` },
    ],
  });
  const text = textOf(completion);
  const rating = [...text.matchAll(/Rating:\s*\**\s*([1-5])\b/gi)].at(-1);
  // No rating is a failure of the judge, not a low score: it's thrown, so it's
  // counted as missing rather than averaged in.
  if (!rating) throw new Error(`The judge gave no rating: ${text.slice(-200)}`);
  return { key: SPECIFICITY_KEY, score: Number(rating[1]), comment: text };
}

async function main(args: string[]): Promise<void> {
  const client = traces();
  await ensureDataset(client, DATASET, "Explanation prompts built from fresh parses, with the paths each one shows the model.", args.includes("--rebuild"), build);

  const scores = new Map<string, Map<string, Map<string, number>>>();
  const inventions: string[] = [];
  for (const version of VERSIONS) {
    console.log(`\nrunning ${version.name} prompt`);
    const results = await evaluate(
      async (inputs: Record<string, unknown>) => ({ body: await completeExplanation(asExample(inputs).user, version.system) }),
      {
        data: DATASET,
        client,
        experimentPrefix: `explain-${version.name}`,
        description: `The ${version.name} explanation prompt. ${SPECIFICITY_KEY} is judged by ${JUDGE}, a model's opinion; ${INVENTED_PATHS_KEY} is exact.`,
        metadata: { prompt: version.name, model: MODEL.explain, judge: JUDGE },
        maxConcurrency: 4,
        evaluators: [inventedPaths, specificity],
      },
    );
    const byKey = new Map<string, Map<string, number>>([
      [INVENTED_PATHS_KEY, new Map()],
      [SPECIFICITY_KEY, new Map()],
    ]);
    for (const row of results.results) {
      for (const result of row.evaluationResults.results) {
        if (typeof result.score === "number") byKey.get(result.key)?.set(row.example.id, result.score);
        if (result.key === INVENTED_PATHS_KEY && result.score === 0) {
          inventions.push(`  ${version.name}  ${String(row.example.inputs.target)}: ${result.comment}`);
        }
      }
    }
    console.log(`  ${results.experimentName}: ${results.results.length} examples`);
    scores.set(version.name, byKey);
  }

  report(scores);
  if (inventions.length) console.log(`\ninvented paths:\n${inventions.join("\n")}`);
}

function report(scores: Map<string, Map<string, Map<string, number>>>): void {
  const current = scores.get("current")!;
  const retired = scores.get("retired")!;
  const mean = (values: Map<string, number>) => [...values.values()].reduce((a, b) => a + b, 0) / values.size;

  const clean = (byKey: Map<string, Map<string, number>>) => byKey.get(INVENTED_PATHS_KEY)!;
  const [a, b] = [clean(current), clean(retired)];
  const count = (values: Map<string, number>) => [...values.values()].filter((score) => score === 1).length;
  console.log("\n                          current      retired      difference");
  console.log(
    `no invented paths         ${`${count(a)}/${a.size}`.padEnd(13)}${`${count(b)}/${b.size}`.padEnd(13)}${signed(100 * (mean(a) - mean(b)), 1)} points (exact)`,
  );

  const [x, y] = [current.get(SPECIFICITY_KEY)!, retired.get(SPECIFICITY_KEY)!];
  // Compared only where both versions were rated, so a missing rating can't
  // move the gap.
  const paired = [...x.keys()].filter((id) => y.has(id));
  const gaps = paired.map((id) => x.get(id)! - y.get(id)!);
  const gap = gaps.reduce((s, g) => s + g, 0) / (gaps.length || 1);
  console.log(
    `specificity, 1–5 (judged) ${mean(x).toFixed(2).padEnd(13)}${mean(y).toFixed(2).padEnd(13)}${signed(gap, 2)} on ${paired.length} paired examples`,
  );
  console.log(
    `                          current rated higher on ${gaps.filter((g) => g > 0).length}, retired on ${gaps.filter((g) => g < 0).length}, tied on ${gaps.filter((g) => g === 0).length}`,
  );
  const missing = x.size + y.size - 2 * paired.length;
  if (missing) console.error(`\n${missing} ratings are missing because the judge errored or gave no rating. See the experiments' traces.`);
  console.log(`\nspecificity is ${JUDGE}'s opinion of each explanation, not a measurement. no_invented_paths is exact.`);
}

function signed(value: number, digits: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
