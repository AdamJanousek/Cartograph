import { posix } from "node:path";
import {
  EDGE_KINDS,
  IMPORT_OUTCOMES,
  SCHEMA_VERSION,
  type Coverage,
  type Edge,
  type EdgeKind,
  type ExcludedDirectory,
  type FileNode,
  type ImportOutcome,
  type ImportReason,
  type ImportRecord,
  type ParseResult,
  type ReasonGroup,
  type SkippedFile,
  type SkipReason,
} from "./types.ts";

// Reads a written result back into the typed shape, rebuilding every object
// field by field so nothing reaches the caller unchecked. It then checks the
// things a type can't say: every edge points at a file that exists, fan counts
// agree with the edges, and the file counts add up.

const IMPORT_REASONS: readonly ImportReason[] = [
  "package",
  "builtin",
  "url",
  "outside-root",
  "non-source-file",
  "skipped-file",
  "excluded-directory",
  "relative-not-found",
  "alias-not-found",
  "workspace-package-not-found",
  "undeclared-bare-specifier",
  "non-literal-dynamic-import",
];
const SKIP_REASONS: readonly SkipReason[] = ["too-large", "minified", "not-utf8", "symlink", "read-error", "parse-error"];
const DIRECTORY_REASONS: readonly ExcludedDirectory["reason"][] = ["dependencies", "hidden", "build-output", "symlink"];

export class InvalidParseResult extends Error {}

export function readParseResult(json: string): ParseResult {
  return checkParseResult(JSON.parse(json));
}

/** The same checks, for a result that arrived as a value rather than as text. */
export function checkParseResult(value: unknown): ParseResult {
  const result = decodeResult(value, "$");
  checkIntegrity(result);
  return result;
}

function decodeResult(value: unknown, at: string): ParseResult {
  const o = object(value, at);
  const version = number(o.schemaVersion, `${at}.schemaVersion`);
  if (version !== SCHEMA_VERSION) fail(`${at}.schemaVersion`, `expected ${SCHEMA_VERSION}, got ${version}`);
  return {
    schemaVersion: SCHEMA_VERSION,
    root: string(o.root, `${at}.root`),
    frameworks: array(o.frameworks, `${at}.frameworks`, string),
    files: array(o.files, `${at}.files`, decodeFile),
    edges: array(o.edges, `${at}.edges`, decodeEdge),
    coverage: decodeCoverage(o.coverage, `${at}.coverage`),
  };
}

function decodeFile(value: unknown, at: string): FileNode {
  const o = object(value, at);
  return {
    path: string(o.path, `${at}.path`),
    folder: string(o.folder, `${at}.folder`),
    lines: count(o.lines, `${at}.lines`),
    bytes: count(o.bytes, `${at}.bytes`),
    hash: string(o.hash, `${at}.hash`),
    role: nullable(o.role, `${at}.role`, string),
    fanIn: count(o.fanIn, `${at}.fanIn`),
    fanOut: count(o.fanOut, `${at}.fanOut`),
  };
}

function decodeEdge(value: unknown, at: string): Edge {
  const o = object(value, at);
  const kinds = array(o.kinds, `${at}.kinds`, (v, a) => oneOf(v, a, EDGE_KINDS));
  if (kinds.length === 0) fail(`${at}.kinds`, "empty");
  return {
    from: string(o.from, `${at}.from`),
    to: string(o.to, `${at}.to`),
    kinds,
    typeOnly: boolean(o.typeOnly, `${at}.typeOnly`),
  };
}

function decodeCoverage(value: unknown, at: string): Coverage {
  const o = object(value, at);
  const files = object(o.files, `${at}.files`);
  const imports = object(o.imports, `${at}.imports`);
  const byKind = object(imports.byKind, `${at}.imports.byKind`);
  const kindCounts = (kind: EdgeKind) => outcomes(byKind[kind], `${at}.imports.byKind.${kind}`);
  return {
    files: {
      found: count(files.found, `${at}.files.found`),
      parsed: count(files.parsed, `${at}.files.parsed`),
      skipped: count(files.skipped, `${at}.files.skipped`),
      skips: array(files.skips, `${at}.files.skips`, decodeSkip),
      excludedDirectories: array(files.excludedDirectories, `${at}.files.excludedDirectories`, decodeDirectory),
    },
    imports: {
      total: count(imports.total, `${at}.imports.total`),
      byOutcome: outcomes(imports.byOutcome, `${at}.imports.byOutcome`),
      byKind: { import: kindCounts("import"), "re-export": kindCounts("re-export"), "dynamic-import": kindCounts("dynamic-import") },
      reasons: array(imports.reasons, `${at}.imports.reasons`, decodeGroup),
    },
  };
}

function decodeSkip(value: unknown, at: string): SkippedFile {
  const o = object(value, at);
  return {
    path: string(o.path, `${at}.path`),
    reason: oneOf(o.reason, `${at}.reason`, SKIP_REASONS),
    detail: string(o.detail, `${at}.detail`),
  };
}

function decodeDirectory(value: unknown, at: string): ExcludedDirectory {
  const o = object(value, at);
  return { path: string(o.path, `${at}.path`), reason: oneOf(o.reason, `${at}.reason`, DIRECTORY_REASONS) };
}

function decodeGroup(value: unknown, at: string): ReasonGroup {
  const o = object(value, at);
  const outcome = oneOf(o.outcome, `${at}.outcome`, IMPORT_OUTCOMES);
  if (outcome === "resolved") fail(`${at}.outcome`, "resolved imports have no reason group");
  return {
    outcome,
    reason: oneOf(o.reason, `${at}.reason`, IMPORT_REASONS),
    count: count(o.count, `${at}.count`),
    examples: array(o.examples, `${at}.examples`, decodeRecord),
  };
}

function decodeRecord(value: unknown, at: string): ImportRecord {
  const o = object(value, at);
  return {
    from: string(o.from, `${at}.from`),
    specifier: nullable(o.specifier, `${at}.specifier`, string),
    kind: oneOf(o.kind, `${at}.kind`, EDGE_KINDS),
    line: count(o.line, `${at}.line`),
    typeOnly: boolean(o.typeOnly, `${at}.typeOnly`),
    outcome: oneOf(o.outcome, `${at}.outcome`, IMPORT_OUTCOMES),
    reason: nullable(o.reason, `${at}.reason`, (v, a) => oneOf(v, a, IMPORT_REASONS)),
    target: nullable(o.target, `${at}.target`, string),
    detail: nullable(o.detail, `${at}.detail`, string),
  };
}

function checkIntegrity(result: ParseResult): void {
  const paths = new Set<string>();
  for (const file of result.files) {
    if (paths.has(file.path)) fail("$.files", `duplicate path ${file.path}`);
    if (file.folder !== posix.dirname(file.path)) fail("$.files", `folder of ${file.path} is ${file.folder}`);
    paths.add(file.path);
  }

  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();
  const pairs = new Set<string>();
  for (const edge of result.edges) {
    if (!paths.has(edge.from)) fail("$.edges", `edge from missing file ${edge.from}`);
    if (!paths.has(edge.to)) fail("$.edges", `edge to missing file ${edge.to}`);
    const pair = `${edge.from}\0${edge.to}`;
    if (pairs.has(pair)) fail("$.edges", `duplicate edge ${edge.from} -> ${edge.to}`);
    pairs.add(pair);
    fanOut.set(edge.from, (fanOut.get(edge.from) ?? 0) + 1);
    fanIn.set(edge.to, (fanIn.get(edge.to) ?? 0) + 1);
  }
  for (const file of result.files) {
    if (file.fanIn !== (fanIn.get(file.path) ?? 0)) fail("$.files", `fanIn of ${file.path} disagrees with edges`);
    if (file.fanOut !== (fanOut.get(file.path) ?? 0)) fail("$.files", `fanOut of ${file.path} disagrees with edges`);
  }

  const files = result.coverage.files;
  if (files.parsed !== result.files.length) fail("$.coverage.files.parsed", "doesn't match the file list");
  if (files.skipped !== files.skips.length) fail("$.coverage.files.skipped", "doesn't match the skip list");
  if (files.found !== files.parsed + files.skipped) fail("$.coverage.files.found", "isn't parsed + skipped");

  const imports = result.coverage.imports;
  const outcomeTotal = IMPORT_OUTCOMES.reduce((sum, outcome) => sum + imports.byOutcome[outcome], 0);
  if (outcomeTotal !== imports.total) fail("$.coverage.imports.byOutcome", "doesn't add up to total");
  for (const group of imports.reasons) {
    if (group.outcome === "unresolved" && group.examples.length !== group.count) {
      fail("$.coverage.imports.reasons", `unresolved "${group.reason}" lost examples`);
    }
  }
}

function fail(at: string, message: string): never {
  throw new InvalidParseResult(`${at}: ${message}`);
}

function object(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(at, "expected an object");
  return { ...value };
}

function array<T>(value: unknown, at: string, item: (value: unknown, at: string) => T): T[] {
  if (!Array.isArray(value)) fail(at, "expected an array");
  return value.map((entry: unknown, index) => item(entry, `${at}[${index}]`));
}

function string(value: unknown, at: string): string {
  if (typeof value !== "string") fail(at, "expected a string");
  return value;
}

function number(value: unknown, at: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(at, "expected a number");
  return value;
}

function count(value: unknown, at: string): number {
  const n = number(value, at);
  if (!Number.isInteger(n) || n < 0) fail(at, "expected a non-negative integer");
  return n;
}

function boolean(value: unknown, at: string): boolean {
  if (typeof value !== "boolean") fail(at, "expected a boolean");
  return value;
}

function nullable<T>(value: unknown, at: string, decode: (value: unknown, at: string) => T): T | null {
  return value === null ? null : decode(value, at);
}

function oneOf<T extends string>(value: unknown, at: string, allowed: readonly T[]): T {
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) fail(at, `expected one of ${allowed.join(", ")}`);
  return match;
}

function outcomes(value: unknown, at: string): Record<ImportOutcome, number> {
  const o = object(value, at);
  return {
    resolved: count(o.resolved, `${at}.resolved`),
    external: count(o.external, `${at}.external`),
    excluded: count(o.excluded, `${at}.excluded`),
    unresolved: count(o.unresolved, `${at}.unresolved`),
  };
}
