import { readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { ts } from "ts-morph";

// Every file is resolved with the options of its nearest tsconfig/jsconfig, so
// each package of a monorepo keeps its own path aliases.

export interface ResolutionConfig {
  options: ts.CompilerOptions;
  /** Path-alias patterns, e.g. "@/*", with the directory their targets are relative to. */
  aliases: { pattern: string; targets: string[]; base: string }[];
  cache: ts.ModuleResolutionCache;
}

export interface LocalPackage {
  name: string;
  /** Absolute directory holding the package.json. */
  directory: string;
  manifest: Record<string, unknown>;
}

export interface PackageIndex {
  /** Packages defined inside the repository, by name. */
  local: Map<string, LocalPackage>;
  /** Every dependency name declared by any package.json in the repository. */
  declared: Set<string>;
  /** Parsed manifests, keyed by repository-relative path. */
  manifests: Map<string, unknown>;
}

const CONFIG_NAMES = ["tsconfig.json", "jsconfig.json"];

// Only options are wanted from a config, not its file list, so skip the
// directory scan its "include" globs would trigger.
const configHost: ts.ParseConfigHost = {
  useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  readDirectory: () => [],
};

export class ConfigLookup {
  private readonly byDirectory = new Map<string, ResolutionConfig>();
  private readonly byConfigFile = new Map<string, ResolutionConfig>();
  private readonly fallback: ResolutionConfig;
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
    this.fallback = makeConfig({}, root, []);
  }

  /** Config for a repository-relative directory. */
  forDirectory(relativeDir: string): ResolutionConfig {
    const cached = this.byDirectory.get(relativeDir);
    if (cached) return cached;

    let found: ResolutionConfig | null = null;
    for (const name of CONFIG_NAMES) {
      const path = join(this.root, relativeDir, name);
      if (ts.sys.fileExists(path)) {
        found = this.load(path);
        break;
      }
    }
    const config = found ?? (relativeDir === "." ? this.fallback : this.forDirectory(posix.dirname(relativeDir)));
    this.byDirectory.set(relativeDir, config);
    return config;
  }

  private load(configPath: string): ResolutionConfig {
    const cached = this.byConfigFile.get(configPath);
    if (cached) return cached;

    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    // A config whose "extends" points into an uninstalled package still yields
    // its own options; the errors are about what it couldn't inherit.
    const parsed = ts.parseJsonConfigFileContent(read.config ?? {}, configHost, dirname(configPath), undefined, configPath);
    const paths = parsed.options.paths ?? {};
    const base = parsed.options.baseUrl ?? dirname(configPath);
    const aliases = Object.entries(paths).map(([pattern, targets]) => ({ pattern, targets, base }));
    const config = makeConfig(parsed.options, dirname(configPath), aliases);
    this.byConfigFile.set(configPath, config);
    return config;
  }
}

function makeConfig(
  options: ts.CompilerOptions,
  directory: string,
  aliases: ResolutionConfig["aliases"],
): ResolutionConfig {
  // Bundler resolution regardless of what the repository targets: it accepts
  // extensionless and ".js"-for-".ts" specifiers alike, which is how the code
  // was actually resolved by whatever built it. The repository's own aliases
  // and baseUrl are kept.
  const merged: ts.CompilerOptions = {
    ...options,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    allowJs: true,
    resolveJsonModule: true,
  };
  return {
    options: merged,
    aliases,
    cache: ts.createModuleResolutionCache(directory, (name) => name, merged),
  };
}

export function indexPackages(root: string, packageJsonPaths: readonly string[]): PackageIndex {
  const index: PackageIndex = { local: new Map(), declared: new Set(), manifests: new Map() };
  for (const path of packageJsonPaths) {
    let manifest: unknown;
    try {
      manifest = JSON.parse(readFileSync(join(root, path), "utf8"));
    } catch {
      continue;
    }
    if (!isRecord(manifest)) continue;
    index.manifests.set(path, manifest);

    if (typeof manifest.name === "string") {
      index.local.set(manifest.name, { name: manifest.name, directory: join(root, posix.dirname(path)), manifest });
    }
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      const deps = manifest[field];
      if (isRecord(deps)) for (const name of Object.keys(deps)) index.declared.add(name);
    }
  }
  return index;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
