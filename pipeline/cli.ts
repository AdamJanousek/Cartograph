// Usage:
//   node pipeline/cli.ts <github url or owner/name>
//
// The run without the database: fetch, select, parse, and print what would be
// stored. Checks the GitHub half of the pipeline from a terminal.

import { parseSelection, selectFiles } from "../parser/index.ts";
import { fetchArchive, parseRepositoryUrl } from "./fetch.ts";

async function main(input: string | undefined): Promise<void> {
  if (!input) {
    console.error("usage: node pipeline/cli.ts <github url or owner/name>");
    process.exit(2);
  }
  const repository = parseRepositoryUrl(input);
  const started = performance.now();
  const lap = (stage: string) => console.log(`${seconds(started).padStart(7)}  ${stage}`);

  lap(`fetching   ${repository.owner}/${repository.name}`);
  const archive = await fetchArchive(repository);
  try {
    lap(`selecting  commit ${archive.commitSha}`);
    const selection = selectFiles(archive.directory);
    lap(`parsing    ${selection.walk.files.length} source files, ${selection.walk.skips.length} skipped`);
    const result = parseSelection(selection);
    lap(`done`);

    const { files, imports } = result.coverage;
    const rows = result.edges.reduce((sum, edge) => sum + edge.kinds.length, 0);
    console.log(`\nframeworks ${result.frameworks.join(", ") || "none"}`);
    console.log(`files      ${result.files.length} rows, ${result.files.filter((file) => file.role).length} with a role`);
    console.log(`edges      ${result.edges.length} connections, ${rows} rows`);
    console.log(`coverage   found ${files.found}  parsed ${files.parsed}  skipped ${files.skipped}`);
    console.log(`imports    ${Object.entries(imports.byOutcome).map(([outcome, n]) => `${outcome} ${n}`).join("  ")}`);
    console.log(`coverage json ${Math.round(JSON.stringify(result.coverage).length / 1024)} KB`);
  } finally {
    await archive.remove();
  }
}

function seconds(since: number): string {
  return `${((performance.now() - since) / 1000).toFixed(2)}s`;
}

main(process.argv[2]).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
