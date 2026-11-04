// The parser's output. Everything downstream reads this shape, so changing it
// means bumping SCHEMA_VERSION and updating the validator in the same change.

export const SCHEMA_VERSION = 2;

export type EdgeKind = "import" | "re-export" | "dynamic-import";

export const EDGE_KINDS: readonly EdgeKind[] = ["import", "re-export", "dynamic-import"];

export interface FileNode {
  /** Repository-relative, forward slashes. The file's identity everywhere. */
  path: string;
  /** Directory containing the file, repository-relative. "." for the root. */
  folder: string;
  lines: number;
  bytes: number;
  /** sha256 of the raw contents, hex. */
  hash: string;
  /** What the framework adapter says this file is; null when it says nothing. */
  role: string | null;
  /** Distinct files that import this one. */
  fanIn: number;
  /** Distinct files this one imports. */
  fanOut: number;
}

/** One connection between two parsed files, after duplicates are removed. */
export interface Edge {
  from: string;
  to: string;
  /** Every way `from` reaches `to`, sorted. Never empty. */
  kinds: EdgeKind[];
  /** True only when every import behind this edge is type-only. */
  typeOnly: boolean;
}

export type ImportOutcome = "resolved" | "external" | "excluded" | "unresolved";

export const IMPORT_OUTCOMES: readonly ImportOutcome[] = ["resolved", "external", "excluded", "unresolved"];

export type ExternalReason =
  | "package" // a declared dependency
  | "builtin" // a Node built-in module
  | "url"
  | "outside-root"; // a path that leaves the repository

export type ExcludedReason =
  | "non-source-file" // resolves to a file the parser doesn't read (css, json, svg…)
  | "skipped-file" // resolves to a source file that was skipped
  | "excluded-directory"; // resolves into a directory the walk doesn't enter

export type UnresolvedReason =
  | "relative-not-found"
  | "alias-not-found"
  | "workspace-package-not-found"
  | "undeclared-bare-specifier"
  | "non-literal-dynamic-import";

export type ImportReason = ExternalReason | ExcludedReason | UnresolvedReason;

/** A single import as written in a file, and what became of it. */
export type ImportRecord = {
  from: string;
  /** The module specifier as written; null for a non-literal dynamic import. */
  specifier: string | null;
  kind: EdgeKind;
  line: number;
  typeOnly: boolean;
  outcome: ImportOutcome;
  /** Present for every outcome except "resolved". */
  reason: ImportReason | null;
  /** Repository-relative target when the import landed inside the repository. */
  target: string | null;
  /** Human-readable explanation, e.g. which candidates were tried. */
  detail: string | null;
};

export type ReasonGroup = {
  outcome: Exclude<ImportOutcome, "resolved">;
  reason: ImportReason;
  count: number;
  /** Every unresolved import is kept; other outcomes keep the first few. */
  examples: ImportRecord[];
};

export type SkipReason = "too-large" | "minified" | "not-utf8" | "symlink" | "read-error" | "parse-error";

export type SkippedFile = {
  path: string;
  reason: SkipReason;
  detail: string;
};

export type ExcludedDirectory = {
  path: string;
  reason: "dependencies" | "hidden" | "build-output" | "symlink";
};

// The types inside Coverage are aliases, not interfaces, so the report can be
// stored as JSON as it is: only aliases satisfy a JSON index signature.
export type Coverage = {
  files: {
    /** Source files the walk saw: found = parsed + skipped. */
    found: number;
    parsed: number;
    skipped: number;
    skips: SkippedFile[];
    /** Directories the walk didn't enter. Their files aren't counted as found. */
    excludedDirectories: ExcludedDirectory[];
  };
  imports: {
    total: number;
    byOutcome: Record<ImportOutcome, number>;
    byKind: Record<EdgeKind, Record<ImportOutcome, number>>;
    reasons: ReasonGroup[];
  };
};

export interface ParseResult {
  schemaVersion: typeof SCHEMA_VERSION;
  /** What was parsed: an absolute path, or owner/name for a stored analysis, whose path was temporary. */
  root: string;
  /** Frameworks detected in any of the repository's packages, sorted. Empty when none. */
  frameworks: string[];
  files: FileNode[];
  edges: Edge[];
  coverage: Coverage;
}
