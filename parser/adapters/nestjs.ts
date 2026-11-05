import { type CallExpression, type Decorator, Node, SyntaxKind, type SourceFile } from "ts-morph";
import { FRAMEWORK, ROLE } from "../taxonomy.ts";
import type { RouteMethod } from "../types.ts";
import {
  declares,
  type FrameworkAdapter,
  isTestPath,
  joinRoute,
  literalString,
  methodCalls,
  type PackageRoute,
  type PackageWithheld,
  parts,
  propertyName,
} from "./shared.ts";

// NestJS names a file for what it holds — users.controller.ts — so roles come
// from the suffix. A route is the controller's path and the method's path
// together, read off the two decorators. Only decorators imported from
// @nestjs/common count, and only when their arguments are written out as
// strings; anything else is withheld with the reason.
//
// Three things outside the decorators can change every path in a package: a
// global prefix, RouterModule, and URI versioning. A prefix written as a
// string is applied. Anything else withholds the package's routes.

const SUFFIXES: Record<string, string> = {
  controller: ROLE.controller,
  resolver: ROLE.resolver,
  gateway: ROLE.gateway,
  service: ROLE.service,
  module: ROLE.module,
  entity: ROLE.entity,
  repository: ROLE.repository,
  schema: ROLE.schema,
  dto: ROLE.dto,
  guard: ROLE.guard,
  interceptor: ROLE.interceptor,
  pipe: ROLE.pipe,
  filter: ROLE.filter,
  middleware: ROLE.middleware,
  strategy: ROLE.strategy,
  decorator: ROLE.decorator,
};

const SOURCE_EXTENSIONS = new Set([".ts", ".js", ".mts", ".cts", ".mjs", ".cjs"]);

const METHOD_DECORATORS: Record<string, RouteMethod> = {
  Get: "GET",
  Post: "POST",
  Put: "PUT",
  Delete: "DELETE",
  Patch: "PATCH",
  Options: "OPTIONS",
  Head: "HEAD",
  Search: "SEARCH",
  All: "ALL",
};

function role(path: string): string | null {
  const { dirs, name, ext } = parts(path);
  if (!SOURCE_EXTENSIONS.has(ext)) return null;
  if (/\.e2e-spec$/.test(name)) return ROLE.test;
  if (dirs.length === 1 && dirs[0] === "src" && name === "main") return ROLE.entryPoint;
  const suffix = /\.([a-z]+)$/.exec(name)?.[1];
  return suffix !== undefined && suffix in SUFFIXES ? SUFFIXES[suffix] : null;
}

/** Local names bound to a package's named exports: `import { Get as G }` maps "G" to "Get". */
function importsFrom(source: SourceFile, module: string): Map<string, string> {
  const names = new Map<string, string>();
  for (const declaration of source.getImportDeclarations()) {
    if (declaration.getModuleSpecifierValue() !== module) continue;
    for (const named of declaration.getNamedImports()) {
      names.set(named.getAliasNode()?.getText() ?? named.getName(), named.getName());
    }
  }
  return names;
}

/** The imported name a decorator calls, when it's a call to a name imported from @nestjs/common. */
function decoratorName(decorator: Decorator, common: Map<string, string>): { name: string; call: CallExpression } | null {
  const call = decorator.getCallExpression();
  if (!call) return null;
  const callee = call.getExpression();
  if (!Node.isIdentifier(callee)) return null;
  const name = common.get(callee.getText());
  return name === undefined ? null : { name, call };
}

/**
 * The paths a decorator argument names: none written means the empty path,
 * a string is one path, an array of strings is several. Null when any of it
 * isn't written out.
 */
function literalPaths(node: Node | undefined): string[] | null {
  if (node === undefined) return [""];
  const single = literalString(node);
  if (single !== null) return [single];
  if (Node.isArrayLiteralExpression(node)) {
    const values = node.getElements().map((element) => literalString(element));
    return values.every((value) => value !== null) ? (values as string[]) : null;
  }
  return null;
}

/** @Controller('users'), @Controller(['a', 'b']) or @Controller({ path: 'users', … }). */
function controllerPaths(call: CallExpression): string[] | null {
  const [argument, ...rest] = call.getArguments();
  if (rest.length > 0) return null;
  if (argument !== undefined && Node.isObjectLiteralExpression(argument)) {
    const properties = argument.getProperties();
    if (properties.some((property) => propertyName(property) === null)) return null; // a spread or computed key
    const path = properties.find((property) => propertyName(property) === "path");
    if (path === undefined) return [""];
    return Node.isPropertyAssignment(path) ? literalPaths(path.getInitializer()) : null;
  }
  return literalPaths(argument);
}

interface FileFacts {
  routes: PackageRoute[];
  withheld: PackageWithheld[];
  /** Every setGlobalPrefix call, with its prefix when it's a string and nothing else is passed. */
  prefixes: { line: number; value: string | null }[];
  versioning: number[];
  routerModule: number[];
  /** How many NestFactory.create calls start an HTTP application here. */
  applications: number;
}

function readFile(path: string, source: SourceFile): FileFacts {
  const facts: FileFacts = { routes: [], withheld: [], prefixes: [], versioning: [], routerModule: [], applications: 0 };
  const common = importsFrom(source, "@nestjs/common");
  const core = importsFrom(source, "@nestjs/core");

  for (const call of methodCalls(source, "setGlobalPrefix")) {
    const [argument, ...rest] = call.getArguments();
    facts.prefixes.push({ line: call.getStartLineNumber(), value: rest.length === 0 ? literalString(argument) : null });
  }
  for (const call of methodCalls(source, "enableVersioning")) facts.versioning.push(call.getStartLineNumber());
  for (const declaration of source.getImportDeclarations()) {
    if (declaration.getModuleSpecifierValue() !== "@nestjs/core") continue;
    if (declaration.getNamedImports().some((named) => named.getName() === "RouterModule")) {
      facts.routerModule.push(declaration.getStartLineNumber());
    }
  }
  const factories = [...core].filter(([, imported]) => imported === "NestFactory").map(([local]) => local);
  facts.applications = methodCalls(source, "create").filter((call) => {
    const callee = call.getExpression();
    return Node.isPropertyAccessExpression(callee) && factories.includes(callee.getExpression().getText());
  }).length;

  if (common.size === 0) return facts;
  for (const cls of source.getDescendantsOfKind(SyntaxKind.ClassDeclaration)) {
    const controller = cls.getDecorators().map((d) => decoratorName(d, common)).find((d) => d?.name === "Controller");
    if (!controller) continue;
    const bases = controllerPaths(controller.call);
    if (bases === null) {
      facts.withheld.push({ path, line: controller.call.getStartLineNumber(), reason: "@Controller path isn't written as a string" });
      continue;
    }
    for (const method of cls.getInstanceMethods()) {
      for (const decorator of method.getDecorators()) {
        const found = decoratorName(decorator, common);
        if (!found || !(found.name in METHOD_DECORATORS)) continue;
        const args = found.call.getArguments();
        const paths = args.length > 1 ? null : literalPaths(args[0]);
        const line = decorator.getStartLineNumber();
        if (paths === null) {
          facts.withheld.push({ path, line, reason: `@${found.name} path isn't written as a string` });
          continue;
        }
        for (const base of bases) {
          for (const sub of paths) {
            facts.routes.push({ method: METHOD_DECORATORS[found.name], pattern: joinRoute(base, sub), file: path, line });
          }
        }
      }
    }
  }
  return facts;
}

export const nestjs: FrameworkAdapter = {
  name: FRAMEWORK.nest,
  detect: (manifest) => declares(manifest, "@nestjs/core"),
  read() {
    const files: { path: string; facts: FileFacts }[] = [];
    return {
      visit({ path, source }) {
        // Tests build their own applications; what they configure isn't the app's.
        if (!isTestPath(path) && !/\.e2e-spec$/.test(parts(path).name)) files.push({ path, facts: readFile(path, source) });
        return role(path);
      },

      routes(skipped) {
        const withhold = (path: string, line: number | null, reason: string) => ({ routes: [], withheld: [{ path, line, reason }] });
        // Any of the package's code could set a prefix, so code that couldn't be read leaves it unknown.
        if (skipped.length > 0) {
          return withhold(".", null, `${skipped.length} source file${skipped.length === 1 ? "" : "s"} couldn't be parsed, so a global prefix can't be ruled out`);
        }
        for (const { path, facts } of files) {
          if (facts.routerModule.length > 0) return withhold(path, facts.routerModule[0], "RouterModule sets path prefixes outside the decorators");
          if (facts.versioning.length > 0) return withhold(path, facts.versioning[0], "URI versioning can add a version segment to every path");
        }

        const prefixes = files.flatMap(({ path, facts }) => facts.prefixes.map((prefix) => ({ path, ...prefix })));
        const unreadable = prefixes.find((prefix) => prefix.value === null);
        if (unreadable) return withhold(unreadable.path, unreadable.line, "setGlobalPrefix is given something other than a single string");
        const values = new Set(prefixes.map((prefix) => prefix.value));
        if (values.size > 1) return withhold(prefixes[1].path, prefixes[1].line, "setGlobalPrefix is called with different prefixes");
        // One prefix, but more than one application it could belong to.
        const applications = files.reduce((sum, { facts }) => sum + facts.applications, 0);
        if (prefixes.length > 0 && applications !== 1) {
          return withhold(prefixes[0].path, prefixes[0].line, `setGlobalPrefix is called, and ${applications} NestFactory.create calls could own it`);
        }
        const prefix = prefixes[0]?.value ?? "";

        return {
          routes: files.flatMap(({ facts }) => facts.routes.map((route) => ({ ...route, pattern: joinRoute(prefix, route.pattern) }))),
          withheld: files.flatMap(({ facts }) => facts.withheld),
        };
      },
    };
  },
};
