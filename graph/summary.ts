import type { Edge, FileNode, ParseResult } from "../parser/types.ts";
import { type Category, categorize, type FileType, fileType } from "./categories.ts";
import { type FoldedNode, groupFan } from "./fold.ts";
import { railCategories } from "../parser/taxonomy.ts";

// What the detail pane says, derived from the parser's output and nothing else.

export interface RankedFile {
  path: string;
  /** What the file is ranked by: fan-in for the depended-on list, fan-out for the unimported one. */
  count: number;
}

export interface RepositorySummary {
  /** Frameworks detected in any package; null when none was. */
  framework: string | null;
  /** Categories the rail lists for those frameworks, empty ones it pins included. */
  categories: number;
  files: number;
  /** Source files the walk found but couldn't parse. */
  skipped: number;
  /** Every import written in the code, whatever became of it. */
  imports: number;
  /** Of those, the ones that resolved to a file in the repository. */
  resolvedImports: number;
  /** Files something imports, most importers first. */
  mostDependedOn: RankedFile[];
  /** Files nothing imports, the ones reaching furthest first: where reading starts. */
  unimported: RankedFile[];
  /** Files no framework convention recognised. */
  unidentified: number;
}

export function summarize(result: ParseResult): RepositorySummary {
  const { files, coverage } = result;
  return {
    framework: result.frameworks.length === 0 ? null : result.frameworks.join(", "),
    categories: railCategories(result.frameworks, files.map((file) => file.role)).length,
    files: files.length,
    skipped: coverage.files.skipped,
    imports: coverage.imports.total,
    resolvedImports: coverage.imports.byOutcome.resolved,
    mostDependedOn: rank(files.filter((file) => file.fanIn > 0), (file) => file.fanIn),
    unimported: rank(files.filter((file) => file.fanIn === 0), (file) => file.fanOut),
    unidentified: files.filter((file) => file.role === null).length,
  };
}

export interface Neighbour {
  path: string;
  /** Every import behind this connection is type-only. */
  typeOnly: boolean;
}

export interface FileDetail {
  file: FileNode;
  type: FileType;
  /** Files this one imports, sorted. */
  imports: Neighbour[];
  /** Files that import this one, sorted. */
  importers: Neighbour[];
}

/**
 * Both lists come from the edges themselves, and the pane shows their lengths
 * as the counts, so a count can never disagree with the rows under it.
 */
export function fileDetail(file: FileNode, edges: readonly Edge[]): FileDetail {
  const imports: Neighbour[] = [];
  const importers: Neighbour[] = [];
  for (const edge of edges) {
    if (edge.from === file.path) imports.push({ path: edge.to, typeOnly: edge.typeOnly });
    if (edge.to === file.path) importers.push({ path: edge.from, typeOnly: edge.typeOnly });
  }
  const byPath = (a: Neighbour, b: Neighbour) => (a.path < b.path ? -1 : 1);
  return { file, type: fileType(file.path), imports: imports.sort(byPath), importers: importers.sort(byPath) };
}

export interface FolderDetail {
  id: string;
  files: number;
  fanIn: number;
  fanOut: number;
  types: Category[];
}

export function folderDetail(node: FoldedNode, byPath: ReadonlyMap<string, FileNode>, edges: readonly Edge[]): FolderDetail {
  const fan = groupFan(new Set(node.files), edges);
  return {
    id: node.id,
    files: node.files.length,
    fanIn: fan.fanIn,
    fanOut: fan.fanOut,
    types: categorize(node.files.map((path) => byPath.get(path)!)),
  };
}

function rank(files: readonly FileNode[], by: (file: FileNode) => number): RankedFile[] {
  return files
    .map((file) => ({ path: file.path, count: by(file) }))
    .sort((a, b) => b.count - a.count || (a.path < b.path ? -1 : 1));
}
