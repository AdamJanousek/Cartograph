import type { Client } from "langsmith";
import type { ExampleCreate } from "langsmith/schemas";

// A dataset is built once and then kept, so every experiment over it, today's
// and next month's, runs on the same examples. --rebuild replaces it, which
// leaves experiments run on the old one comparable only with each other.

export async function ensureDataset(
  client: Client,
  name: string,
  description: string,
  rebuild: boolean,
  build: () => Promise<ExampleCreate[]>,
): Promise<void> {
  const exists = await client.hasDataset({ datasetName: name });
  if (exists && !rebuild) {
    console.log(`dataset ${name}: using the stored one (pass --rebuild to replace it)`);
    return;
  }
  const examples = await build();
  if (exists) await client.deleteDataset({ datasetName: name });
  const dataset = await client.createDataset(name, { description });
  await client.createExamples(examples.map((example) => ({ ...example, dataset_id: dataset.id })));
  console.log(`dataset ${name}: built ${examples.length} examples`);
}
