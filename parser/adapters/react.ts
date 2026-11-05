import { ROLE, FRAMEWORK } from "../taxonomy.ts";
import { declares, type FrameworkAdapter, parts } from "./shared.ts";

// React has no routing convention, so it has no routes. What it does have is
// naming conventions strong enough to read: a component file is named for its
// component, a hook file for its hook.

const COMPONENT_EXTENSIONS = new Set([".tsx", ".jsx"]);
const HOOK_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

/**
 * Components and hooks by file name. Shared with Next.js, which is React
 * underneath, for the files its own conventions don't name.
 */
export function reactNameRole(path: string): string | null {
  const { name, ext } = parts(path);
  if (COMPONENT_EXTENSIONS.has(ext) && /^[A-Z][A-Za-z0-9]*$/.test(name)) return ROLE.component;
  // useThing, or use-thing as kebab-case codebases write it.
  if (HOOK_EXTENSIONS.has(ext) && /^use(?:[A-Z][A-Za-z0-9]*|-[a-z0-9][a-z0-9-]*)$/.test(name)) return ROLE.hook;
  return null;
}

export const react: FrameworkAdapter = {
  name: FRAMEWORK.react,
  detect: (manifest) => declares(manifest, "react"),
  read: () => ({
    visit({ path }) {
      const { dirs, name, ext } = parts(path);
      // Where Vite and Create React App mount the tree.
      if (dirs.length === 1 && dirs[0] === "src" && (name === "main" || name === "index") && HOOK_EXTENSIONS.has(ext)) {
        return ROLE.entryPoint;
      }
      return reactNameRole(path);
    },
    routes: () => ({ routes: [], withheld: [] }),
  }),
};
