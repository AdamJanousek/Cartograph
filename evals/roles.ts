// Usage:
//   node evals/roles.ts [--rebuild]
//
// Role accuracy. Convention assigns some roles with certainty, and those files
// never reach the model in normal operation, which makes them a held-out set
// with real ground truth: hide the role, ask the model, compare.
//
// Only roles the classifier is allowed to answer with are in the set. A file
// convention calls a controller or a page is a question the model is
// forbidden to answer, and scoring it there would measure nothing.
//
// The model sees exactly what production shows it, path included. Convention
// read these roles off the path, so the model can too; that's part of the job
// it does in production, and this number includes it.

import "./env.ts";
import type { ExampleCreate } from "langsmith/schemas";
import { evaluate } from "langsmith/evaluation";
import { MODEL, traces } from "../ai/client.ts";
import { askRoles, describeForLabel, isModelRole, MODEL_ROLES } from "../ai/label.ts";
import { ensureDataset } from "./dataset.ts";
import { spread, withParsed } from "./repositories.ts";

const DATASET = "cartograph-roles";

// Between them: an Express app's models and services, a NestJS app's services
// and repositories, two React libraries' components and hooks, and every
// toolchain's config files.
const REPOSITORIES = [
  "hagopj13/node-express-boilerplate",
  "brocoders/nestjs-boilerplate",
  "react-bootstrap/react-bootstrap",
  "streamich/react-use",
];

/** Per role per repository, so no one role or repository dominates the score. */
const PER_ROLE = 6;

async function build(): Promise<ExampleCreate[]> {
  const examples: ExampleCreate[] = [];
  for (const repository of REPOSITORIES) {
    await withParsed(repository, async ({ label, result, read }) => {
      const imports = new Map<string, string[]>();
      const importers = new Map<string, string[]>();
      for (const edge of result.edges) {
        (imports.get(edge.from) ?? imports.set(edge.from, []).get(edge.from)!).push(edge.to);
        (importers.get(edge.to) ?? importers.set(edge.to, []).get(edge.to)!).push(edge.from);
      }
      for (const role of MODEL_ROLES) {
        // A fresh parse has no model in it: every role here is convention's.
        const files = result.files.filter((file) => file.role === role);
        for (const file of spread(files, PER_ROLE)) {
          examples.push({
            inputs: {
              path: file.path,
              frameworks: result.frameworks,
              description: describeForLabel(file.path, await read(file.path), imports.get(file.path), importers.get(file.path)),
            },
            reference_outputs: { role },
            metadata: { repository: label },
          });
        }
      }
      console.log(`  ${label}: ${examples.length} examples so far`);
    });
  }
  return examples;
}

async function main(args: string[]): Promise<void> {
  const client = traces();
  await ensureDataset(client, DATASET, "Files whose role convention assigned, among the roles the classifier may give. Inputs are what the classifier is shown; the role is hidden.", args.includes("--rebuild"), build);

  const results = await evaluate(
    async (inputs: Record<string, unknown>) => {
      const { path, description, frameworks } = inputs;
      if (typeof path !== "string" || typeof description !== "string" || !Array.isArray(frameworks)) {
        throw new Error("Example inputs aren't a described file.");
      }
      const answered = await askRoles([{ path, text: description }], frameworks.map(String));
      // Left out of the answer and answered "none" are both no role, as in the app.
      return { role: answered.get(path) ?? null };
    },
    {
      data: DATASET,
      client,
      experimentPrefix: "roles",
      description: `Role classifier, ${MODEL.label}`,
      metadata: { model: MODEL.label },
      maxConcurrency: 4,
      evaluators: [
        ({ outputs, referenceOutputs }: { outputs: Record<string, unknown>; referenceOutputs?: Record<string, unknown> }) => {
          const expected: unknown = referenceOutputs?.role;
          // Checked on every run, not just at build time: a hand-edited
          // dataset must not quietly ask a forbidden question.
          if (!isModelRole(expected)) throw new Error(`The dataset holds a role the classifier may not give: ${String(expected)}.`);
          const said: unknown = outputs.role;
          return { key: "role_correct", score: said === expected ? 1 : 0, comment: `expected ${expected}, said ${said ?? "none"}` };
        },
      ],
    },
  );

  // The score, and where it came from.
  const rows = results.results.map((row) => ({
    expected: String(row.example.outputs?.role),
    said: typeof row.run.outputs?.role === "string" ? row.run.outputs.role : null,
    failed: Boolean(row.run.error),
  }));
  const failed = rows.filter((row) => row.failed).length;
  if (failed) console.error(`\n${failed} examples errored instead of answering. They count as wrong.`);
  const correct = rows.filter((row) => row.said === row.expected).length;
  console.log(`\nrole accuracy ${correct}/${rows.length} = ${((100 * correct) / rows.length).toFixed(1)}%   (${results.experimentName})`);
  console.log(`said none on ${rows.filter((row) => row.said === null).length}\n`);
  for (const role of MODEL_ROLES) {
    const of = rows.filter((row) => row.expected === role);
    if (!of.length) continue;
    const wrong = of.filter((row) => row.said !== role).map((row) => row.said ?? "none");
    const tally = [...new Set(wrong)].map((answer) => `${answer} ×${wrong.filter((w) => w === answer).length}`).join(", ");
    console.log(`  ${role.padEnd(10)} ${of.length - wrong.length}/${of.length}${tally ? `   wrong: ${tally}` : ""}`);
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
