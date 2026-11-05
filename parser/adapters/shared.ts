import { posix } from "node:path";
import { Node, SyntaxKind, type SourceFile } from "ts-morph";
import { isRecord } from "../config.ts";
import type { RouteMethod } from "../types.ts";

// What every adapter is handed and what it hands back. The parser asks these
// questions; it never asks which framework it's in.

export interface PackageFile {
  /** Relative to the package's own directory. */
  path: string;
  source: SourceFile;
}

export interface PackageRoute {
  method: RouteMethod;
  pattern: string;
  /** Relative to the package's directory. */
  file: string;
  line: number | null;
}

export interface PackageWithheld {
  /** Relative to the package's directory; "." for the whole package. */
  path: string;
  line: number | null;
  reason: string;
}

/**
 * Reads one package. The parser hands it every parsed file under the package
 * once, while the file's syntax tree is alive, then asks for routes once.
 */
export interface PackageReader {
  /** What the framework's conventions say this file is, or null if they say nothing. */
  visit(file: PackageFile): string | null;
  /**
   * Every route the package's files pin down exactly. `skipped` lists the
   * package's source files that couldn't be parsed: something in one of them
   * may change every route, and an adapter has to say so rather than guess.
   */
  routes(skipped: readonly string[]): { routes: PackageRoute[]; withheld: PackageWithheld[] };
}

export interface FrameworkAdapter {
  readonly name: string;
  /** Whether this package.json declares the framework. */
  detect(manifest: Record<string, unknown>): boolean;
  read(): PackageReader;
}

/** Splits "a/b/page.tsx" into its directory segments, its name and its extension. */
export function parts(path: string): { dirs: string[]; name: string; ext: string } {
  const base = posix.basename(path);
  const ext = base.endsWith(".d.ts") ? ".d.ts" : posix.extname(base);
  const dir = posix.dirname(path);
  return { dirs: dir === "." ? [] : dir.split("/"), name: base.slice(0, base.length - ext.length), ext };
}

export function declares(manifest: Record<string, unknown>, name: string): boolean {
  return ["dependencies", "devDependencies", "peerDependencies"].some((field) => {
    const deps = manifest[field];
    return isRecord(deps) && name in deps;
  });
}

/** Whether a test runner would pick the file up by its name or folder. */
export function isTestPath(path: string): boolean {
  const { dirs, name } = parts(path);
  return dirs.includes("__tests__") || dirs.includes("__mocks__") || /\.(test|spec)$/.test(name);
}

/** A string written out in full: a plain literal, or a template with nothing substituted. */
export function literalString(node: Node | undefined): string | null {
  if (node && (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node))) return node.getLiteralValue();
  return null;
}

/** A property's name when it's written as a name or a string, not computed. */
export function propertyName(node: Node): string | null {
  if (Node.isPropertyAssignment(node) || Node.isShorthandPropertyAssignment(node)) {
    const name = node.getNameNode();
    if (Node.isIdentifier(name)) return name.getText();
    return literalString(name);
  }
  return null;
}

/** Whether the file's directive prologue holds this directive, e.g. "use server". */
export function hasDirective(source: SourceFile, directive: string): boolean {
  for (const statement of source.getStatements()) {
    if (!Node.isExpressionStatement(statement)) return false;
    // A directive is a plain string literal; a template literal ends the prologue.
    const expression = statement.getExpression();
    if (!Node.isStringLiteral(expression)) return false;
    if (expression.getLiteralValue() === directive) return true;
  }
  return false;
}

/** The line a file's default export is written on, or null when it has none written out. */
export function defaultExportLine(source: SourceFile): number | null {
  for (const statement of source.getStatements()) {
    if (Node.isExportAssignment(statement) && !statement.isExportEquals()) return statement.getStartLineNumber();
    if ((Node.isFunctionDeclaration(statement) || Node.isClassDeclaration(statement)) && statement.hasDefaultKeyword()) {
      return statement.getStartLineNumber();
    }
    if (Node.isExportDeclaration(statement)) {
      const named = statement.getNamedExports().find((spec) => (spec.getAliasNode()?.getText() ?? spec.getName()) === "default");
      if (named) return statement.getStartLineNumber();
    }
  }
  return null;
}

/**
 * Every name the file exports, as written, with the line it's exported on.
 * `export *` names nothing here: what it exports lives in another file.
 */
export function exportedNames(source: SourceFile): { name: string; line: number }[] {
  const found: { name: string; line: number }[] = [];
  for (const statement of source.getStatements()) {
    const line = statement.getStartLineNumber();
    if (Node.isFunctionDeclaration(statement) || Node.isClassDeclaration(statement)) {
      const name = statement.getName();
      if (statement.isExported() && !statement.hasDefaultKeyword() && name) found.push({ name, line });
    } else if (Node.isVariableStatement(statement)) {
      if (!statement.isExported()) continue;
      for (const declaration of statement.getDeclarations()) {
        for (const name of bindingNames(declaration.getNameNode())) found.push({ name, line: declaration.getStartLineNumber() });
      }
    } else if (Node.isExportDeclaration(statement) && !statement.isNamespaceExport()) {
      for (const spec of statement.getNamedExports()) {
        found.push({ name: spec.getAliasNode()?.getText() ?? spec.getName(), line });
      }
    }
  }
  return found;
}

/** The names a declaration binds, including every leaf of `const { GET, POST } = handlers`. */
function bindingNames(node: Node): string[] {
  if (Node.isIdentifier(node)) return [node.getText()];
  if (Node.isObjectBindingPattern(node) || Node.isArrayBindingPattern(node)) {
    return node
      .getElements()
      .flatMap((element) => (Node.isBindingElement(element) ? bindingNames(element.getNameNode()) : []));
  }
  return [];
}

/** Joins path pieces the way routers do: one slash between pieces, a leading one, no trailing one. */
export function joinRoute(...pieces: string[]): string {
  const segments = pieces.flatMap((piece) => piece.split("/")).filter((segment) => segment !== "");
  return `/${segments.join("/")}`;
}

/** Every call in the file whose callee is `<anything>.<name>(…)`. */
export function methodCalls(source: SourceFile, name: string) {
  return source.getDescendantsOfKind(SyntaxKind.CallExpression).filter((call) => {
    const callee = call.getExpression();
    return Node.isPropertyAccessExpression(callee) && callee.getName() === name;
  });
}
