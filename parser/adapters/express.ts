import { FRAMEWORK, ROLE } from "../taxonomy.ts";
import { declares, type FrameworkAdapter, isTestPath, parts } from "./shared.ts";

// Express has no file conventions of its own, but Express codebases share
// folder names for their layers. Repositories write them singular and plural
// both, so both are accepted. The deepest matching folder decides, so
// routes/admin/middleware/auth.js is middleware.
//
// No routes. Express assembles them at runtime from routers, variables and
// middleware chains, so no single file's syntax pins one down exactly.

const FOLDERS: Record<string, string> = {
  routes: ROLE.router,
  route: ROLE.router,
  routers: ROLE.router,
  router: ROLE.router,
  controllers: ROLE.controller,
  controller: ROLE.controller,
  models: ROLE.model,
  model: ROLE.model,
  middleware: ROLE.middleware,
  middlewares: ROLE.middleware,
  services: ROLE.service,
  service: ROLE.service,
};

export const express: FrameworkAdapter = {
  name: FRAMEWORK.express,
  detect: (manifest) => declares(manifest, "express"),
  read: () => ({
    visit({ path }) {
      // Tests and declaration files are the toolchain's to name, wherever they sit.
      const { dirs, ext } = parts(path);
      if (isTestPath(path) || ext === ".d.ts") return null;
      const folder = dirs.findLast((dir) => dir in FOLDERS);
      return folder === undefined ? null : FOLDERS[folder];
    },
    routes: () => ({ routes: [], withheld: [] }),
  }),
};
