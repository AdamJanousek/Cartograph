import { Node, SyntaxKind, type SourceFile } from "ts-morph";
import { FRAMEWORK, ROLE } from "../taxonomy.ts";
import type { RouteMethod } from "../types.ts";
import { reactNameRole } from "./react.ts";
import {
  declares,
  defaultExportLine,
  exportedNames,
  type FrameworkAdapter,
  hasDirective,
  joinRoute,
  literalString,
  type PackageRoute,
  parts,
  propertyName,
} from "./shared.ts";

// Next.js routes are its file paths, so roles and routes come from the same
// reading of a path. A page answers GET. A route handler answers each HTTP
// method it exports by name. A pages/api handler is one function for every
// method; which it accepts isn't written anywhere a parser can read, so it is
// an API endpoint with no route.

// Next's default pageExtensions. Anything else in app/ or pages/ isn't routed.
const NEXT_EXTENSIONS = new Set([".tsx", ".ts", ".jsx", ".js"]);

// App Router files the framework loads by name.
const APP_FILES: Record<string, string> = {
  page: ROLE.page,
  route: ROLE.apiEndpoint,
  layout: ROLE.layout,
  template: ROLE.template,
  loading: ROLE.loading,
  error: ROLE.error,
  "global-error": ROLE.globalError,
  "not-found": ROLE.notFound,
  forbidden: ROLE.forbidden,
  unauthorized: ROLE.unauthorized,
  default: ROLE.default,
};
// Metadata files become routes too, but their URLs depend on extension and
// generator functions, so they get a role and no route.
const METADATA_FILES = new Set(["icon", "apple-icon", "opengraph-image", "twitter-image", "sitemap", "robots", "manifest"]);

// The methods a route handler may export, from Next's route handler docs.
const HANDLER_METHODS = new Set<RouteMethod>(["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]);

const CONFIG_NAME = "next.config";

/** Where an app/ or pages/ file sits: the router it belongs to and the segments under it. */
function routerOf(dirs: string[]): { router: "app" | "pages"; segments: string[] } | null {
  // app/ and pages/ may sit at the package root or under src/.
  const inner = dirs[0] === "src" ? dirs.slice(1) : dirs;
  if (inner[0] === "app" || inner[0] === "pages") return { router: inner[0], segments: inner.slice(1) };
  return null;
}

function conventionRole(path: string): string | null {
  const { dirs, name, ext } = parts(path);
  if (dirs.length === 0 && name === CONFIG_NAME) return ROLE.config;
  if (!NEXT_EXTENSIONS.has(ext)) return null;

  const inner = dirs[0] === "src" ? dirs.slice(1) : dirs;
  if (inner.length === 0) {
    if (name === "middleware") return ROLE.middleware;
    if (name === "proxy") return ROLE.proxy;
    if (name === "instrumentation" || name === "instrumentation-client") return ROLE.instrumentation;
    return null;
  }
  const router = routerOf(dirs);
  if (router?.router === "app") {
    // A folder starting with "_" is private: nothing in it is routed.
    if (router.segments.some((segment) => segment.startsWith("_"))) return null;
    if (name in APP_FILES) return APP_FILES[name];
    if (METADATA_FILES.has(name)) return ROLE.metadata;
    return null;
  }
  if (router?.router === "pages") {
    if (router.segments[0] === "api") return ROLE.apiEndpoint;
    if (router.segments.length === 0) {
      if (name === "_app") return ROLE.customApp;
      if (name === "_document") return ROLE.customDocument;
      if (name === "_error") return ROLE.customError;
    }
    return ROLE.page;
  }
  return null;
}

/**
 * The URL an App Router page or handler serves, or null when its folder
 * doesn't name one: a parallel-route slot renders inside another route, and
 * an intercepting route only exists on top of the route it intercepts.
 */
function appPattern(segments: string[]): string | null {
  const kept: string[] = [];
  for (const segment of segments) {
    if (segment.startsWith("@") || segment.startsWith("(.")) return null;
    // A route group organises files without adding to the URL.
    if (segment.startsWith("(") && segment.endsWith(")")) continue;
    kept.push(segment);
  }
  return joinRoute(...kept);
}

function pagesPattern(segments: string[], name: string): string {
  return joinRoute(...segments, name === "index" ? "" : name);
}

function handlerRoutes(source: SourceFile, file: string, pattern: string): PackageRoute[] {
  return exportedNames(source).flatMap(({ name, line }) =>
    HANDLER_METHODS.has(name as RouteMethod) ? [{ method: name as RouteMethod, pattern, file, line }] : [],
  );
}

/**
 * What next.config says about basePath: absent, a string written out, or
 * something only running the config would tell.
 */
type BasePath = { kind: "none" } | { kind: "literal"; value: string } | { kind: "unknown"; line: number; reason: string };

/**
 * Why the exported config can't be read in full from this file, or null when
 * it can. Reading basePath off the object literals is only sound when every
 * object the export is built from is written here: a spread or an imported
 * object could carry a basePath this file never shows.
 *
 * A call such as withBundleAnalyzer({ … }) is followed into its arguments and
 * the plugin itself is taken not to set basePath. That's the one assumption
 * made: withholding every wrapped config would empty the route table of most
 * real Next.js apps, and no common plugin sets basePath.
 */
function untraceableConfig(source: SourceFile): { line: number; reason: string } | null {
  const exported: Node[] = [];
  for (const statement of source.getStatements()) {
    if (Node.isExportAssignment(statement)) exported.push(statement.getExpression());
    if (Node.isFunctionDeclaration(statement) && statement.hasDefaultKeyword()) exported.push(statement);
    if (Node.isExpressionStatement(statement)) {
      const expression = statement.getExpression();
      if (
        Node.isBinaryExpression(expression) &&
        expression.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
        expression.getLeft().getText() === "module.exports"
      ) {
        exported.push(expression.getRight());
      }
    }
  }
  if (exported.length === 0) return { line: 1, reason: "next.config exports nothing a parser can read" };

  const seen = new Set<Node>();
  const trace = (node: Node): { line: number; reason: string } | null => {
    if (seen.has(node)) return null;
    seen.add(node);
    const line = node.getStartLineNumber();
    if (Node.isParenthesizedExpression(node) || Node.isAsExpression(node) || Node.isSatisfiesExpression(node)) {
      return trace(node.getExpression());
    }
    if (Node.isObjectLiteralExpression(node)) {
      // basePath is a top-level key, so only a spread at this level can hide one.
      const spread = node.getProperties().find((property) => Node.isSpreadAssignment(property));
      if (spread) return { line: spread.getStartLineNumber(), reason: "next.config spreads another object, which may set basePath" };
      return null;
    }
    if (Node.isIdentifier(node)) {
      // An imported name resolves to its import, not a variable, so it stops here.
      const declaration = node
        .getSymbol()
        ?.getDeclarations()
        .find((candidate) => Node.isVariableDeclaration(candidate) && candidate.getSourceFile() === source);
      const initializer = declaration && Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : undefined;
      if (!initializer) return { line, reason: `next.config exports ${node.getText()}, which isn't defined in the file` };
      return trace(initializer);
    }
    if (Node.isCallExpression(node)) {
      if (node.getExpression().getText() === "require") {
        return { line, reason: "next.config exports a config from another file" };
      }
      // A curried plugin, withX(options)(config), is followed through its callee too.
      const callee = node.getExpression();
      if (Node.isCallExpression(callee)) {
        const inner = trace(callee);
        if (inner) return inner;
      }
      for (const argument of node.getArguments()) {
        if (Node.isFunctionLikeDeclaration(argument)) continue;
        const inner = trace(argument);
        if (inner) return inner;
      }
      return null;
    }
    if (Node.isArrowFunction(node) || Node.isFunctionExpression(node) || Node.isFunctionDeclaration(node)) {
      const body = node.getBody();
      if (body === undefined) return { line, reason: "next.config exports a function with no body" };
      if (!Node.isBlock(body)) return trace(body);
      // Only this function's own returns: a webpack() hook inside the config returns something else.
      const returned = body
        .getDescendantsOfKind(SyntaxKind.ReturnStatement)
        .filter((statement) => statement.getFirstAncestor((ancestor) => Node.isFunctionLikeDeclaration(ancestor)) === node)
        .map((statement) => statement.getExpression());
      if (returned.length === 0) return { line, reason: "next.config exports a function that returns nothing a parser can read" };
      for (const expression of returned) {
        if (!expression) return { line, reason: "next.config exports a function that returns nothing a parser can read" };
        const inner = trace(expression);
        if (inner) return inner;
      }
      return null;
    }
    return { line, reason: "next.config exports something other than an object written in the file" };
  };
  for (const node of exported) {
    const found = trace(node);
    if (found) return found;
  }
  return null;
}

function readBasePath(source: SourceFile): BasePath {
  const untraceable = untraceableConfig(source);
  if (untraceable) return { kind: "unknown", ...untraceable };
  let found: BasePath = { kind: "none" };
  for (const node of source.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression).flatMap((o) => o.getProperties())) {
    const name = propertyName(node);
    // pageExtensions changes which files are pages at all.
    if (name === "pageExtensions") {
      return { kind: "unknown", line: node.getStartLineNumber(), reason: "next.config sets pageExtensions" };
    }
    if (name !== "basePath") continue;
    const value = Node.isPropertyAssignment(node) ? literalString(node.getInitializer()) : null;
    if (value === null) {
      return { kind: "unknown", line: node.getStartLineNumber(), reason: "next.config sets basePath to something other than a string literal" };
    }
    if (found.kind === "literal" && found.value !== value) {
      return { kind: "unknown", line: node.getStartLineNumber(), reason: "next.config sets basePath more than once" };
    }
    found = { kind: "literal", value };
  }
  return found;
}

export const nextjs: FrameworkAdapter = {
  name: FRAMEWORK.next,
  detect: (manifest) => declares(manifest, "next"),
  read() {
    const found: PackageRoute[] = [];
    let config: { path: string; basePath: BasePath } | null = null;

    return {
      visit({ path, source }) {
        const { dirs, name } = parts(path);
        if (dirs.length === 0 && name === CONFIG_NAME) config = { path, basePath: readBasePath(source) };

        const role = conventionRole(path);
        const router = routerOf(dirs);
        if (router?.router === "app" && (role === ROLE.page || role === ROLE.apiEndpoint)) {
          const pattern = appPattern(router.segments);
          if (pattern !== null) {
            if (role === ROLE.page) found.push({ method: "GET", pattern, file: path, line: defaultExportLine(source) });
            else found.push(...handlerRoutes(source, path, pattern));
          }
        }
        if (router?.router === "pages" && role === ROLE.page) {
          found.push({ method: "GET", pattern: pagesPattern(router.segments, name), file: path, line: defaultExportLine(source) });
        }
        if (role !== null) return role;

        // Anywhere in the app, a file whose prologue says "use server" exports server actions.
        if (hasDirective(source, "use server")) return ROLE.serverAction;
        return reactNameRole(path);
      },

      routes(skipped) {
        const skippedConfig = skipped.find((path) => {
          const { dirs, name } = parts(path);
          return dirs.length === 0 && name === CONFIG_NAME;
        });
        if (skippedConfig) {
          return { routes: [], withheld: [{ path: skippedConfig, line: null, reason: "next.config couldn't be parsed, so its basePath is unknown" }] };
        }
        // No config file means no basePath.
        const read: { path: string; basePath: BasePath } = config ?? { path: CONFIG_NAME, basePath: { kind: "none" } };
        const { basePath } = read;
        if (basePath.kind === "unknown") {
          return { routes: [], withheld: [{ path: read.path, line: basePath.line, reason: basePath.reason }] };
        }
        const prefix = basePath.kind === "literal" ? basePath.value : "";
        return {
          routes: found.map((route) => ({ ...route, pattern: joinRoute(prefix, route.pattern) })),
          withheld: [],
        };
      },
    };
  },
};
