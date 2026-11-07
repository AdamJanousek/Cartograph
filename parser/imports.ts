import { Node, SyntaxKind, ts, type SourceFile } from "ts-morph";
import type { EdgeKind } from "./types.ts";

export interface RawImport {
  /** null when a dynamic import's or require()'s argument isn't a literal string. */
  specifier: string | null;
  kind: EdgeKind;
  line: number;
  typeOnly: boolean;
}

// Four things become edges: static imports (including side-effect-only ones),
// re-exports with a "from" clause, import() called with a literal string, and
// require() called with a literal string — TypeScript's `import x = require()`
// included. A require() whose argument isn't a literal is still recorded, with
// no specifier, so it's counted as unresolved rather than vanishing.
export function extractImports(sourceFile: SourceFile): RawImport[] {
  const found: RawImport[] = [];

  for (const declaration of sourceFile.getImportDeclarations()) {
    const named = declaration.getNamedImports();
    found.push({
      specifier: declaration.getModuleSpecifierValue(),
      kind: "import",
      line: declaration.getStartLineNumber(),
      // `import { type A, type B }` erases just as completely as `import type`.
      typeOnly: declaration.isTypeOnly() || (named.length > 0 && !declaration.getDefaultImport() && !declaration.getNamespaceImport() && named.every((n) => n.isTypeOnly())),
    });
  }

  for (const declaration of sourceFile.getExportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    if (specifier === undefined) continue; // `export { a }` re-exports nothing from elsewhere
    const named = declaration.getNamedExports();
    found.push({
      specifier,
      kind: "re-export",
      line: declaration.getStartLineNumber(),
      typeOnly: declaration.isTypeOnly() || (named.length > 0 && named.every((n) => n.isTypeOnly())),
    });
  }

  for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.ImportEqualsDeclaration)) {
    const reference = declaration.getModuleReference();
    if (!Node.isExternalModuleReference(reference)) continue; // `import x = A.B` names a namespace, not a module
    found.push({
      specifier: literalValue(reference.getExpression()),
      kind: "require",
      line: declaration.getStartLineNumber(),
      typeOnly: declaration.isTypeOnly(),
    });
  }

  const requires: RawImport[] = [];
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getKind() === SyntaxKind.ImportKeyword) {
      found.push({ specifier: literalValue(call.getArguments()[0]), kind: "dynamic-import", line: call.getStartLineNumber(), typeOnly: false });
    } else if (Node.isIdentifier(callee) && callee.getText() === "require") {
      const args = call.getArguments();
      requires.push({ specifier: args.length === 1 ? literalValue(args[0]) : null, kind: "require", line: call.getStartLineNumber(), typeOnly: false });
    }
  }
  // A file that binds its own `require` is calling that, not loading a module.
  if (requires.length > 0 && !declaresRequire(sourceFile)) found.push(...requires);

  return found.sort((a, b) => a.line - b.line);
}

function literalValue(node: Node | undefined): string | null {
  return node && (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) ? node.getLiteralValue() : null;
}

/** Whether anything in the file declares a binding named `require`, at any scope. */
function declaresRequire(sourceFile: SourceFile): boolean {
  return sourceFile.getDescendantsOfKind(SyntaxKind.Identifier).some((identifier) => {
    if (identifier.getText() !== "require") return false;
    const node = identifier.compilerNode;
    const parent = node.parent;
    const named =
      ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isBindingElement(parent) ||
      ts.isImportSpecifier(parent) ||
      ts.isImportClause(parent) ||
      ts.isNamespaceImport(parent) ||
      ts.isImportEqualsDeclaration(parent);
    return named && parent.name === node;
  });
}
