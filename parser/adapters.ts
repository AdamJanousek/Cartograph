import { posix } from "node:path";
import { isRecord } from "./config.ts";

// Framework knowledge lives behind this interface and nowhere else. The parser
// asks the adapters questions; it never asks which framework it's in.
//
// A repository can hold several packages, each with its own framework, so an
// adapter is chosen per package.json, not once for the whole repository.

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
  /** Whether this package.json declares the framework. */
  detect(manifest: Record<string, unknown>): boolean;
  /**
   * What the framework's conventions say this file is, or null if nothing.
   * `path` is relative to the package's own directory.
   */
  role(path: string): string | null;
}

export interface Roles {
  /** Names of the frameworks found in any package, sorted. Empty when none. */
  frameworks: string[];
  /** What a repository-relative file is, or null when no convention says. */
  role(path: string): string | null;
}

/** Splits "a/b/page.tsx" into its directory segments, its name and its extension. */
function parts(path: string): { dirs: string[]; name: string; ext: string } {
  const base = posix.basename(path);
  const ext = base.endsWith(".d.ts") ? ".d.ts" : posix.extname(base);
  const dir = posix.dirname(path);
  return { dirs: dir === "." ? [] : dir.split("/"), name: base.slice(0, base.length - ext.length), ext };
}

function declares(manifest: Record<string, unknown>, name: string): boolean {
  return ["dependencies", "devDependencies", "peerDependencies"].some((field) => {
    const deps = manifest[field];
    return isRecord(deps) && name in deps;
  });
}

// Next's default pageExtensions. Anything else in app/ or pages/ isn't routed.
const NEXT_EXTENSIONS = new Set([".tsx", ".ts", ".jsx", ".js"]);

// App Router files the framework loads by name. Metadata files become routes too.
const NEXT_APP_FILES = new Set([
  "page",
  "layout",
  "template",
  "route",
  "loading",
  "error",
  "global-error",
  "not-found",
  "forbidden",
  "unauthorized",
  "default",
]);
const NEXT_METADATA_FILES = new Set([
  "icon",
  "apple-icon",
  "opengraph-image",
  "twitter-image",
  "sitemap",
  "robots",
  "manifest",
]);

export const nextjs: FrameworkAdapter = {
  name: "next.js",
  detect: (manifest) => declares(manifest, "next"),
  role(path) {
    const { dirs, name, ext } = parts(path);
    if (dirs.length === 0 && name === "next.config") return "config";
    if (!NEXT_EXTENSIONS.has(ext)) return null;

    // app/ and pages/ may sit at the package root or under src/.
    const inner = dirs[0] === "src" ? dirs.slice(1) : dirs;
    if (inner.length === 0) {
      if (name === "middleware") return "middleware";
      if (name === "proxy") return "proxy";
      if (name === "instrumentation" || name === "instrumentation-client") return "instrumentation";
      return null;
    }
    if (inner[0] === "app") {
      // A folder starting with "_" is private: nothing in it is routed.
      if (inner.some((dir) => dir.startsWith("_"))) return null;
      if (NEXT_APP_FILES.has(name)) return name;
      if (NEXT_METADATA_FILES.has(name)) return "metadata";
      return null;
    }
    if (inner[0] === "pages") {
      if (inner[1] === "api") return "api route";
      if (inner.length === 1 && (name === "_app" || name === "_document" || name === "_error")) return name.slice(1);
      return "page";
    }
    return null;
  },
};

export const docusaurus: FrameworkAdapter = {
  name: "docusaurus",
  detect: (manifest) => declares(manifest, "@docusaurus/core"),
  role(path) {
    const { dirs, name } = parts(path);
    if (dirs.length === 0 && (name === "docusaurus.config" || name === "sidebars")) return "config";
    if (dirs[0] !== "src") return null;
    if (dirs[1] === "theme") return "theme override";
    if (dirs[1] === "pages") {
      // Docusaurus's own default excludes for src/pages.
      const excluded =
        [...dirs, name].some((segment) => segment.startsWith("_")) ||
        dirs.includes("__tests__") ||
        /\.(test|spec)$/.test(name);
      return excluded ? null : "page";
    }
    return null;
  },
};

// Ordered most specific first. A package gets the first that detects.
const frameworks: readonly FrameworkAdapter[] = [nextjs, docusaurus];

/**
 * Conventions every JavaScript toolchain shares, whatever the framework: test
 * runners find tests by name, tools load their config by name, and the
 * compiler picks up declaration files from tsconfig. All three are reached
 * without anything importing them.
 */
export function toolchainRole(path: string): string | null {
  const { dirs, name, ext } = parts(path);
  if (dirs.includes("__tests__") || dirs.includes("__mocks__") || /\.(test|spec)$/.test(name)) return "test";
  if (ext === ".d.ts") return "declarations";
  // vite.config.ts, and dotfile configs like .lintstagedrc.js.
  if (/\.config$/.test(name) || /^\.[\w-]+rc$/.test(name)) return "config";
  return null;
}

/**
 * Each file is answered by the framework of the nearest package.json above
 * it, then by the toolchain conventions. A file in a package with no framework
 * gets only the toolchain's answer.
 */
export function assignRoles(repo: RepositoryInfo): Roles {
  const byDirectory = new Map<string, FrameworkAdapter | null>();
  for (const [manifestPath, manifest] of repo.packageJsons) {
    const adapter = isRecord(manifest) ? frameworks.find((candidate) => candidate.detect(manifest)) : undefined;
    byDirectory.set(posix.dirname(manifestPath), adapter ?? null);
  }

  const found = new Set<string>();
  for (const adapter of byDirectory.values()) if (adapter) found.add(adapter.name);

  return {
    frameworks: [...found].sort(),
    role(path) {
      for (let dir = posix.dirname(path); ; dir = posix.dirname(dir)) {
        if (byDirectory.has(dir)) {
          const adapter = byDirectory.get(dir);
          const relative = dir === "." ? path : path.slice(dir.length + 1);
          return adapter?.role(relative) ?? toolchainRole(path);
        }
        if (dir === ".") return toolchainRole(path);
      }
    },
  };
}
