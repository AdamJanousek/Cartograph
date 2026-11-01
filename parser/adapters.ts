// Framework knowledge lives behind this interface and nowhere else. The parser
// asks the chosen adapter questions; it never asks which framework it's in.

export interface RepositoryInfo {
  /** Absolute repository root. */
  root: string;
  /** Repository-relative paths of every parsed source file. */
  files: readonly string[];
  /** Parsed package.json files, keyed by repository-relative path. */
  packageJsons: ReadonlyMap<string, unknown>;
}

export interface FrameworkAdapter {
  readonly name: string;
  /** Whether this adapter's framework is in use. */
  detect(repo: RepositoryInfo): boolean;
  /** What the framework's conventions say this file is, or null if nothing. */
  role(path: string): string | null;
}

/** Assumes no framework at all: recognises nothing, labels nothing. */
export const noFramework: FrameworkAdapter = {
  name: "none",
  detect: () => true,
  role: () => null,
};

// Ordered most specific first; the fallback is last and always matches.
const adapters: readonly FrameworkAdapter[] = [noFramework];

export function chooseAdapter(repo: RepositoryInfo): FrameworkAdapter {
  return adapters.find((adapter) => adapter.detect(repo)) ?? noFramework;
}
