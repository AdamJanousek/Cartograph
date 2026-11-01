import { statSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ts } from "ts-morph";
import { isRecord, type ConfigLookup, type LocalPackage, type PackageIndex } from "./config.ts";
import { isSourcePath } from "./walk.ts";
import type { ImportOutcome, ImportReason, SkippedFile } from "./types.ts";

export interface Resolution {
  outcome: ImportOutcome;
  reason: ImportReason | null;
  target: string | null;
  detail: string | null;
}

const URL_SPECIFIER = /^(https?|data|file):/i;

// TypeScript's own resolver does the work: aliases, index files, ".js" written
// for ".ts", package exports. This class only decides what a result means for
// this repository, and when TypeScript finds nothing, works out why.
export class Resolver {
  private readonly root: string;
  private readonly configs: ConfigLookup;
  private readonly packages: PackageIndex;
  private readonly parsed: ReadonlySet<string>;
  private readonly skipped: ReadonlyMap<string, SkippedFile>;

  constructor(
    root: string,
    configs: ConfigLookup,
    packages: PackageIndex,
    parsed: ReadonlySet<string>,
    skipped: ReadonlyMap<string, SkippedFile>,
  ) {
    this.root = root;
    this.configs = configs;
    this.packages = packages;
    this.parsed = parsed;
    this.skipped = skipped;
  }

  resolve(fromPath: string, folder: string, specifier: string): Resolution {
    if (URL_SPECIFIER.test(specifier)) return external("url", null, null);
    if (isBuiltin(specifier) && !isRelative(specifier)) return external("builtin", null, null);

    const config = this.configs.forDirectory(folder);
    const containingFile = join(this.root, fromPath);
    const found = ts.resolveModuleName(specifier, containingFile, config.options, ts.sys, config.cache).resolvedModule;
    if (found) return this.classifyTarget(found.resolvedFileName);

    if (isRelative(specifier) || isAbsolute(specifier)) {
      const candidate = resolve(dirname(containingFile), specifier);
      if (isFile(candidate)) return this.classifyTarget(candidate);
      if (this.isOutside(candidate)) {
        return external("outside-root", null, `${specifier} leaves the repository`);
      }
      return unresolved(
        "relative-not-found",
        `no file at ${this.relative(candidate)} with any source extension or as a directory index`,
      );
    }

    for (const alias of config.aliases) {
      const wildcard = matchPattern(alias.pattern, specifier);
      if (wildcard === null) continue;
      const tried = alias.targets.map((target) => resolve(alias.base, target.replace("*", wildcard)));
      const asset = tried.find(isFile);
      if (asset) return this.classifyTarget(asset);
      return unresolved(
        "alias-not-found",
        `matches path alias "${alias.pattern}" but nothing exists at ${tried.map((t) => this.relative(t)).join(", ")}`,
      );
    }

    // TypeScript only resolves source files against baseUrl; an asset there
    // is still a real file, not a package.
    if (config.options.baseUrl) {
      const fromBase = resolve(config.options.baseUrl, specifier);
      if (isFile(fromBase)) return this.classifyTarget(fromBase);
    }

    const name = packageName(specifier);
    const local = this.packages.local.get(name);
    if (local) return this.resolveWorkspace(local, specifier.slice(name.length), config.options);
    if (this.packages.declared.has(name)) return external("package", null, name);

    return unresolved(
      "undeclared-bare-specifier",
      `"${name}" is not a declared dependency, a package in this repository, or a path alias`,
    );
  }

  // Without node_modules installed, TypeScript can't follow a workspace
  // package's name to its folder. Read its manifest the way a bundler would.
  private resolveWorkspace(pkg: LocalPackage, subpath: string, options: ts.CompilerOptions): Resolution {
    const candidates = entryCandidates(pkg.manifest, subpath === "" ? "." : `.${subpath}`);
    const manifestPath = join(pkg.directory, "package.json");
    for (const candidate of candidates) {
      const relativeCandidate = candidate.startsWith(".") ? candidate : `./${candidate}`;
      const found = ts.resolveModuleName(relativeCandidate, manifestPath, options, ts.sys).resolvedModule;
      if (found) return this.classifyTarget(found.resolvedFileName);
      const literal = resolve(pkg.directory, candidate);
      if (isFile(literal)) return this.classifyTarget(literal);
    }
    return unresolved(
      "workspace-package-not-found",
      `package "${pkg.name}" is in ${this.relative(pkg.directory)} but none of ${candidates.join(", ")} exists there`,
    );
  }

  private classifyTarget(absolutePath: string): Resolution {
    if (this.isOutside(absolutePath)) {
      return external("outside-root", null, `resolves to ${absolutePath}`);
    }
    const target = this.relative(absolutePath);
    if (target.split("/").includes("node_modules")) return external("package", null, null);
    if (this.parsed.has(target)) return { outcome: "resolved", reason: null, target, detail: null };

    const skip = this.skipped.get(target);
    if (skip) return excluded("skipped-file", target, `target was skipped: ${skip.reason} (${skip.detail})`);
    if (!isSourcePath(target)) return excluded("non-source-file", target, null);
    return excluded("excluded-directory", target, "target is inside a directory the walk doesn't enter");
  }

  private relative(absolutePath: string): string {
    return relative(this.root, absolutePath).split(sep).join("/") || ".";
  }

  private isOutside(absolutePath: string): boolean {
    const rel = relative(this.root, absolutePath);
    return rel.startsWith("..") || isAbsolute(rel);
  }
}

function external(reason: ImportReason, target: string | null, detail: string | null): Resolution {
  return { outcome: "external", reason, target, detail };
}

function excluded(reason: ImportReason, target: string, detail: string | null): Resolution {
  return { outcome: "excluded", reason, target, detail };
}

function unresolved(reason: ImportReason, detail: string): Resolution {
  return { outcome: "unresolved", reason, target: null, detail };
}

function isRelative(specifier: string): boolean {
  return specifier === "." || specifier === ".." || specifier.startsWith("./") || specifier.startsWith("../");
}

function isFile(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
}

function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") && parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0];
}

/** The text matched by "*" in a tsconfig/exports pattern, or null if no match. */
function matchPattern(pattern: string, value: string): string | null {
  const star = pattern.indexOf("*");
  if (star === -1) return pattern === value ? "" : null;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (value.length < prefix.length + suffix.length) return null;
  if (!value.startsWith(prefix) || !value.endsWith(suffix)) return null;
  return value.slice(prefix.length, value.length - suffix.length);
}

// Entry points a package declares for a subpath, in the order a bundler checks
// them: "exports" first, then the legacy fields, then a bare index.
function entryCandidates(manifest: Record<string, unknown>, subpath: string): string[] {
  const candidates: string[] = [];
  const exportsField = manifest.exports;

  if (typeof exportsField === "string" || Array.isArray(exportsField)) {
    if (subpath === ".") candidates.push(...leaves(exportsField));
  } else if (isRecord(exportsField)) {
    const keyed = Object.keys(exportsField).some((key) => key.startsWith("."));
    if (!keyed) {
      if (subpath === ".") candidates.push(...leaves(exportsField));
    } else {
      for (const [key, value] of Object.entries(exportsField)) {
        const wildcard = matchPattern(key, subpath);
        if (wildcard !== null) candidates.push(...leaves(value).map((leaf) => leaf.replace("*", wildcard)));
      }
    }
  }

  if (subpath === ".") {
    for (const field of ["source", "types", "typings", "module", "main"]) {
      const value = manifest[field];
      if (typeof value === "string") candidates.push(value);
    }
    candidates.push("./index");
  } else {
    candidates.push(subpath);
  }
  return [...new Set(candidates)];
}

function leaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(leaves);
  if (isRecord(value)) return Object.values(value).flatMap(leaves);
  return [];
}
