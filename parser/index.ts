import { statSync } from "node:fs";
import { resolve } from "node:path";
import { Project } from "ts-morph";
import { computeFan, dedupeEdges } from "../graph/edges.ts";
import { assignRoles } from "./adapters.ts";
import { ConfigLookup, indexPackages } from "./config.ts";
import { extractImports, type RawImport } from "./imports.ts";
import { Resolver } from "./resolve.ts";
import {
  IMPORT_OUTCOMES,
  SCHEMA_VERSION,
  type Coverage,
  type EdgeKind,
  type ImportOutcome,
  type ImportRecord,
  type ParseResult,
  type ReasonGroup,
  type SkippedFile,
} from "./types.ts";
import { compare, errorMessage, walkRepository, type WalkedFile, type WalkResult } from "./walk.ts";

export * from "./types.ts";

const EXAMPLES_PER_REASON = 5;

/** Reads the repository at `directory` and returns its files, edges and coverage. */
export function parseRepository(directory: string): ParseResult {
  return parseSelection(selectFiles(directory));
}

/** Which files a parse will read, and which it won't. Nothing is parsed yet. */
export interface Selection {
  root: string;
  walk: WalkResult;
}

// Selecting and parsing are separate calls so a caller can say which one is
// happening. Both are synchronous; nothing between them is shared state.
export function selectFiles(directory: string): Selection {
  const root = resolve(directory);
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Not a directory: ${root}`);
  }
  return { root, walk: walkRepository(root) };
}

export function parseSelection({ root, walk }: Selection): ParseResult {
  const skips: SkippedFile[] = [...walk.skips];

  // Contents come from the walk, so ts-morph never touches the disk itself.
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { allowJs: true } });
  const parsed: { file: WalkedFile; imports: RawImport[] }[] = [];
  for (const file of walk.files) {
    try {
      const sourceFile = project.createSourceFile(file.absolutePath, file.text, { overwrite: true });
      parsed.push({ file, imports: extractImports(sourceFile) });
      project.removeSourceFile(sourceFile);
    } catch (error) {
      skips.push({ path: file.path, reason: "parse-error", detail: errorMessage(error) });
    }
  }
  skips.sort((a, b) => compare(a.path, b.path));

  const packages = indexPackages(root, walk.packageJsonPaths);
  const parsedPaths = new Set(parsed.map(({ file }) => file.path));
  const resolver = new Resolver(
    root,
    new ConfigLookup(root),
    packages,
    parsedPaths,
    new Map(skips.map((skip) => [skip.path, skip])),
  );

  const records: ImportRecord[] = [];
  for (const { file, imports } of parsed) {
    for (const raw of imports) {
      const resolution =
        raw.specifier === null
          ? {
              outcome: "unresolved" as const,
              reason: "non-literal-dynamic-import" as const,
              target: null,
              detail: "import() argument is not a string literal",
            }
          : resolver.resolve(file.path, file.folder, raw.specifier);
      records.push({ from: file.path, specifier: raw.specifier, kind: raw.kind, line: raw.line, typeOnly: raw.typeOnly, ...resolution });
    }
  }

  const edges = dedupeEdges(
    records.flatMap((record) =>
      record.outcome === "resolved" && record.target !== null
        ? [{ from: record.from, to: record.target, kind: record.kind, typeOnly: record.typeOnly }]
        : [],
    ),
  );
  const fan = computeFan([...parsedPaths], edges);

  const roles = assignRoles({ root, files: [...parsedPaths], packageJsons: packages.manifests });

  return {
    schemaVersion: SCHEMA_VERSION,
    root,
    frameworks: roles.frameworks,
    files: parsed.map(({ file }) => ({
      path: file.path,
      folder: file.folder,
      lines: file.lines,
      bytes: file.bytes,
      hash: file.hash,
      role: roles.role(file.path),
      fanIn: fan.get(file.path)?.fanIn ?? 0,
      fanOut: fan.get(file.path)?.fanOut ?? 0,
    })),
    edges,
    coverage: buildCoverage(walk.files.length + walk.skips.length, parsed.length, skips, walk.excludedDirectories, records),
  };
}

function buildCoverage(
  found: number,
  parsed: number,
  skips: SkippedFile[],
  excludedDirectories: Coverage["files"]["excludedDirectories"],
  records: ImportRecord[],
): Coverage {
  const byOutcome = emptyOutcomes();
  const byKind: Record<EdgeKind, Record<ImportOutcome, number>> = {
    import: emptyOutcomes(),
    "re-export": emptyOutcomes(),
    "dynamic-import": emptyOutcomes(),
  };
  const groups = new Map<string, ReasonGroup>();

  for (const record of records) {
    byOutcome[record.outcome] += 1;
    byKind[record.kind][record.outcome] += 1;
    if (record.outcome === "resolved" || record.reason === null) continue;

    const key = `${record.outcome}:${record.reason}`;
    let group = groups.get(key);
    if (!group) {
      group = { outcome: record.outcome, reason: record.reason, count: 0, examples: [] };
      groups.set(key, group);
    }
    group.count += 1;
    // Failures are the thing coverage exists to show, so every one is kept.
    if (record.outcome === "unresolved" || group.examples.length < EXAMPLES_PER_REASON) group.examples.push(record);
  }

  return {
    files: { found, parsed, skipped: skips.length, skips, excludedDirectories },
    imports: {
      total: records.length,
      byOutcome,
      byKind,
      reasons: [...groups.values()].sort(
        (a, b) => IMPORT_OUTCOMES.indexOf(b.outcome) - IMPORT_OUTCOMES.indexOf(a.outcome) || b.count - a.count,
      ),
    },
  };
}

function emptyOutcomes(): Record<ImportOutcome, number> {
  return { resolved: 0, external: 0, excluded: 0, unresolved: 0 };
}
