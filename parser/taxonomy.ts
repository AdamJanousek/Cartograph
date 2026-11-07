// The rail's categories, per framework. This file imports nothing, so a
// browser component can read it without pulling in ts-morph or the
// filesystem. The adapters import their role names from here, not the other
// way round, so a role an adapter emits always has a category.
//
// A category is named for the concrete thing ("Controllers"), never an
// abstraction over frameworks ("Entry points"). Order is reading order and
// never changes: routable surfaces first, then the layers behind them, then
// plumbing.

export const ROLE = {
  // Next.js
  page: "page",
  apiEndpoint: "api endpoint",
  serverAction: "server action",
  metadata: "metadata",
  layout: "layout",
  template: "template",
  loading: "loading",
  error: "error",
  globalError: "global-error",
  notFound: "not-found",
  forbidden: "forbidden",
  unauthorized: "unauthorized",
  customError: "custom error",
  default: "default",
  proxy: "proxy",
  instrumentation: "instrumentation",
  customApp: "custom app",
  customDocument: "custom document",
  // React
  component: "component",
  hook: "hook",
  entryPoint: "entry point",
  // NestJS
  controller: "controller",
  resolver: "resolver",
  gateway: "gateway",
  service: "service",
  module: "module",
  entity: "entity",
  repository: "repository",
  schema: "schema",
  dto: "dto",
  guard: "guard",
  interceptor: "interceptor",
  pipe: "pipe",
  filter: "filter",
  strategy: "strategy",
  decorator: "decorator",
  // Express
  router: "router",
  model: "model",
  // Next.js, NestJS and Express
  middleware: "middleware",
  // Docusaurus
  themeOverride: "theme override",
  // Every toolchain
  test: "test",
  config: "config",
  declarations: "declarations",
} as const;

export type Role = (typeof ROLE)[keyof typeof ROLE];

/** The name each adapter reports itself as, and the key its rail is listed under. */
export const FRAMEWORK = {
  nest: "nestjs",
  next: "next.js",
  docusaurus: "docusaurus",
  express: "express",
  react: "react",
} as const;

interface Definition {
  label: string;
  roles: readonly Role[];
}

/** One line of the rail. `roles` holds null only for the files nothing identified. */
export interface RailCategory {
  /** Stable across renders and repositories; the label doubles as it. */
  id: string;
  label: string;
  roles: readonly (string | null)[];
  count: number;
}

// Shared by more than one framework, so the same files land on the same line.
const PAGE_ROUTES: Definition = { label: "Page routes", roles: [ROLE.page] };
const COMPONENTS: Definition = { label: "Components", roles: [ROLE.component] };
const HOOKS: Definition = { label: "Hooks", roles: [ROLE.hook] };
const MIDDLEWARE: Definition = { label: "Middleware", roles: [ROLE.middleware] };
const ENTRY_POINTS: Definition = { label: "Entry points", roles: [ROLE.entryPoint] };
const CONTROLLERS: Definition = { label: "Controllers", roles: [ROLE.controller] };
const SERVICES: Definition = { label: "Services", roles: [ROLE.service] };

// The first `pinned` categories of a framework show even at zero: for those,
// "none" is an answer. The rest show only when something is in them.
const RAILS: Record<string, { pinned: number; categories: readonly Definition[] }> = {
  [FRAMEWORK.nest]: {
    pinned: 4,
    categories: [
      CONTROLLERS,
      SERVICES,
      { label: "Modules", roles: [ROLE.module] },
      { label: "Entities", roles: [ROLE.entity] },
      { label: "Resolvers", roles: [ROLE.resolver] },
      { label: "Gateways", roles: [ROLE.gateway] },
      { label: "Repositories", roles: [ROLE.repository] },
      { label: "Schemas", roles: [ROLE.schema] },
      { label: "DTOs", roles: [ROLE.dto] },
      { label: "Guards", roles: [ROLE.guard] },
      { label: "Interceptors", roles: [ROLE.interceptor] },
      { label: "Pipes", roles: [ROLE.pipe] },
      { label: "Filters", roles: [ROLE.filter] },
      MIDDLEWARE,
      { label: "Strategies", roles: [ROLE.strategy] },
      { label: "Decorators", roles: [ROLE.decorator] },
      ENTRY_POINTS,
    ],
  },
  [FRAMEWORK.next]: {
    pinned: 3,
    categories: [
      PAGE_ROUTES,
      { label: "API endpoints", roles: [ROLE.apiEndpoint] },
      { label: "Server actions", roles: [ROLE.serverAction] },
      { label: "Metadata routes", roles: [ROLE.metadata] },
      { label: "Layouts", roles: [ROLE.layout, ROLE.template] },
      { label: "Loading UI", roles: [ROLE.loading] },
      {
        label: "Error UI",
        roles: [ROLE.error, ROLE.globalError, ROLE.notFound, ROLE.forbidden, ROLE.unauthorized, ROLE.customError],
      },
      { label: "Slot defaults", roles: [ROLE.default] },
      COMPONENTS,
      HOOKS,
      MIDDLEWARE,
      { label: "Proxy", roles: [ROLE.proxy] },
      { label: "Instrumentation", roles: [ROLE.instrumentation] },
      { label: "Custom App and Document", roles: [ROLE.customApp, ROLE.customDocument] },
    ],
  },
  [FRAMEWORK.docusaurus]: {
    pinned: 1,
    categories: [PAGE_ROUTES, { label: "Theme overrides", roles: [ROLE.themeOverride] }],
  },
  [FRAMEWORK.express]: {
    pinned: 2,
    categories: [{ label: "Routers", roles: [ROLE.router] }, CONTROLLERS, { label: "Models", roles: [ROLE.model] }, MIDDLEWARE, SERVICES],
  },
  [FRAMEWORK.react]: {
    pinned: 2,
    categories: [COMPONENTS, HOOKS, ENTRY_POINTS],
  },
};

/** The order frameworks are detected in, which is also the order their rails stack in. */
export const FRAMEWORK_ORDER: readonly string[] = [
  FRAMEWORK.nest,
  FRAMEWORK.next,
  FRAMEWORK.docusaurus,
  FRAMEWORK.express,
  FRAMEWORK.react,
];

const TOOLCHAIN: readonly Definition[] = [
  { label: "Tests", roles: [ROLE.test] },
  { label: "Config", roles: [ROLE.config] },
  { label: "Declarations", roles: [ROLE.declarations] },
];

const UNIDENTIFIED = "Unidentified";

/**
 * The rail for a repository: each detected framework's categories in
 * detection order, then the toolchain's, then the files nothing identified.
 * A repository with no framework gets only the last two.
 */
export function railCategories(frameworks: readonly string[], roles: readonly (string | null)[]): RailCategory[] {
  const counts = new Map<string | null, number>();
  for (const role of roles) counts.set(role, (counts.get(role) ?? 0) + 1);

  const rail: RailCategory[] = [];
  const placed = new Set<string | null>();
  const add = (definition: { label: string; roles: readonly (string | null)[] }, pinned: boolean) => {
    // A category two frameworks share is listed once, where it first appears.
    if (rail.some((category) => category.id === definition.label)) return;
    const count = definition.roles.reduce((sum, role) => sum + (counts.get(role) ?? 0), 0);
    for (const role of definition.roles) placed.add(role);
    if (count > 0 || pinned) rail.push({ id: definition.label, label: definition.label, roles: definition.roles, count });
  };

  for (const framework of FRAMEWORK_ORDER) {
    const definition = RAILS[framework];
    if (!definition || !frameworks.includes(framework)) continue;
    definition.categories.forEach((category, index) => add(category, index < definition.pinned));
  }
  for (const category of TOOLCHAIN) add(category, false);

  // A role no rail lists: shown under its own name rather than dropped, so the
  // rail's counts always add up to the file count.
  for (const [role, count] of counts) {
    if (role === null || placed.has(role)) continue;
    rail.push({ id: `role:${role}`, label: role, roles: [role], count });
  }
  add({ label: UNIDENTIFIED, roles: [null] }, false);
  return rail;
}
