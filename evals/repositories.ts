import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Facts } from "../ai/explain-prompt.ts";
import { parseSelection, selectFiles, type ParseResult } from "../parser/index.ts";
import { fetchArchive, parseRepositoryUrl } from "../pipeline/fetch.ts";

// Datasets are built from a fresh parse of public repositories: the same
// parser the app runs, with no database in between. Building one is the only
// time a repository is fetched; experiments run over what was stored.

export interface Parsed {
  label: string;
  result: ParseResult;
  facts: Facts;
  read: (path: string) => Promise<string>;
}

/** Fetches and parses a repository, hands it to `work`, and removes the archive afterwards. */
export async function withParsed<T>(input: string, work: (parsed: Parsed) => Promise<T>): Promise<T> {
  const repository = parseRepositoryUrl(input);
  const archive = await fetchArchive(repository);
  try {
    const result = parseSelection(selectFiles(archive.directory));
    return await work({
      label: `${repository.owner}/${repository.name}@${archive.commitSha.slice(0, 7)}`,
      result,
      facts: {
        repository,
        frameworks: result.frameworks,
        edges: result.edges,
        byPath: new Map(result.files.map((file) => [file.path, file])),
      },
      read: (path) => readFile(join(archive.directory, path), "utf8"),
    });
  } finally {
    await archive.remove();
  }
}

/** Up to `count` items spread evenly through the list, so a sample isn't just its first few. */
export function spread<T>(items: readonly T[], count: number): T[] {
  if (items.length <= count) return [...items];
  return Array.from({ length: count }, (_, index) => items[Math.floor((index * items.length) / count)]);
}
