import { posix } from "node:path";
import type { SourceFile } from "ts-morph";
import { isRecord } from "../config.ts";
import { ROLE } from "../taxonomy.ts";
import { compareRoutes, type Route, type SkippedFile, type WithheldRoutes } from "../types.ts";
import { compare } from "../walk.ts";
import { docusaurus } from "./docusaurus.ts";
import { nestjs } from "./nestjs.ts";
import { nextjs } from "./nextjs.ts";
import { react } from "./react.ts";
import { type FrameworkAdapter, isTestPath, type PackageReader, parts } from "./shared.ts";

// Framework knowledge lives in this directory and nowhere else.
//
// A repository can hold several packages, each with its own framework, so an
// adapter is chosen per package.json, not once for the whole repository.

// Detection order, fixed; a package gets the first adapter that detects it.
// Next.js and Docusaurus both declare react, so React comes after them.
const ADAPTERS: readonly FrameworkAdapter[] = [nestjs, nextjs, docusaurus, react];

/**
 * Conventions every JavaScript toolchain shares, whatever the framework: test
 * runners find tests by name, tools load their config by name, and the
 * compiler picks up declaration files from tsconfig. All three are reached
 * without anything importing them.
 */
export function toolchainRole(path: string): string | null {
  const { name, ext } = parts(path);
  if (isTestPath(path)) return ROLE.test;
  if (ext === ".d.ts") return ROLE.declarations;
  // vite.config.ts, and dotfile configs like .lintstagedrc.js.
  if (/\.config$/.test(name) || /^\.[\w-]+rc$/.test(name)) return ROLE.config;
  return null;
}

export interface FrameworkReading {
  /** Names of the frameworks found in any package, sorted. Empty when none. */
  frameworks: string[];
  /** What a repository-relative file is, or null when no convention says. Call once per parsed file. */
  role(path: string, source: SourceFile): string | null;
  /** Every package's routes, once every parsed file has had its role. */
  routes(skips: readonly SkippedFile[]): { routes: Route[]; withheld: WithheldRoutes[] };
}

/**
 * Each file is answered by the framework of the nearest package.json above
 * it, then by the toolchain conventions. A file in a package with no
 * framework gets only the toolchain's answer.
 */
export function readFrameworks(packageJsons: ReadonlyMap<string, unknown>): FrameworkReading {
  const readers = new Map<string, { adapter: FrameworkAdapter; reader: PackageReader } | null>();
  for (const [manifestPath, manifest] of packageJsons) {
    const adapter = isRecord(manifest) ? ADAPTERS.find((candidate) => candidate.detect(manifest)) : undefined;
    readers.set(posix.dirname(manifestPath), adapter ? { adapter, reader: adapter.read() } : null);
  }

  /** The nearest package directory above a path, or null outside every package. */
  const packageOf = (path: string): string | null => {
    for (let dir = posix.dirname(path); ; dir = posix.dirname(dir)) {
      if (readers.has(dir)) return dir;
      if (dir === ".") return null;
    }
  };
  const within = (dir: string, path: string) => (dir === "." ? path : path.slice(dir.length + 1));
  const outward = (dir: string, path: string) => (path === "." ? dir : dir === "." ? path : `${dir}/${path}`);

  const found = new Set<string>();
  for (const entry of readers.values()) if (entry) found.add(entry.adapter.name);

  return {
    frameworks: [...found].sort(),
    role(path, source) {
      const dir = packageOf(path);
      const entry = dir === null ? null : readers.get(dir);
      if (dir === null || !entry) return toolchainRole(path);
      return entry.reader.visit({ path: within(dir, path), source }) ?? toolchainRole(path);
    },
    routes(skips) {
      const routes: Route[] = [];
      const withheld: WithheldRoutes[] = [];
      for (const [dir, entry] of readers) {
        if (!entry) continue;
        const skipped = skips.filter((skip) => packageOf(skip.path) === dir).map((skip) => within(dir, skip.path));
        const read = entry.reader.routes(skipped);
        for (const route of read.routes) routes.push({ ...route, file: outward(dir, route.file) });
        for (const item of read.withheld) withheld.push({ ...item, path: outward(dir, item.path) });
      }
      return { routes: dedupe(routes), withheld: withheld.sort((a, b) => compare(a.path, b.path) || (a.line ?? 0) - (b.line ?? 0)) };
    },
  };
}

/** One row per file, method and pattern, the first line kept; sorted by pattern, then method, then file. */
function dedupe(routes: Route[]): Route[] {
  const seen = new Map<string, Route>();
  for (const route of routes) {
    const key = `${route.file}\0${route.method}\0${route.pattern}`;
    if (!seen.has(key)) seen.set(key, route);
  }
  return [...seen.values()].sort(compareRoutes);
}
