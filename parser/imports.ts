import { Node, SyntaxKind, type SourceFile } from "ts-morph";
import type { EdgeKind } from "./types.ts";

export interface RawImport {
  /** null when a dynamic import's argument isn't a literal string. */
  specifier: string | null;
  kind: EdgeKind;
  line: number;
  typeOnly: boolean;
}

// Three things become edges: static imports (including side-effect-only ones),
// re-exports with a "from" clause, and import() called with a literal string.
// require() is deliberately not read yet.
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

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue;
    const argument = call.getArguments()[0];
    const literal =
      argument && (Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument))
        ? argument.getLiteralValue()
        : null;
    found.push({ specifier: literal, kind: "dynamic-import", line: call.getStartLineNumber(), typeOnly: false });
  }

  return found.sort((a, b) => a.line - b.line);
}
