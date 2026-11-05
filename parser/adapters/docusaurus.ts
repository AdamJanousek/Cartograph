import { FRAMEWORK, ROLE } from "../taxonomy.ts";
import { declares, type FrameworkAdapter, parts } from "./shared.ts";

// Roles only. Docusaurus routes depend on plugin options in its config, which
// is more than the syntax of one file pins down.
export const docusaurus: FrameworkAdapter = {
  name: FRAMEWORK.docusaurus,
  detect: (manifest) => declares(manifest, "@docusaurus/core"),
  read: () => ({
    visit({ path }) {
      const { dirs, name } = parts(path);
      if (dirs.length === 0 && (name === "docusaurus.config" || name === "sidebars")) return ROLE.config;
      if (dirs[0] !== "src") return null;
      if (dirs[1] === "theme") return ROLE.themeOverride;
      if (dirs[1] === "pages") {
        // Docusaurus's own default excludes for src/pages.
        const excluded =
          [...dirs, name].some((segment) => segment.startsWith("_")) ||
          dirs.includes("__tests__") ||
          /\.(test|spec)$/.test(name);
        return excluded ? null : ROLE.page;
      }
      return null;
    },
    routes: () => ({ routes: [], withheld: [] }),
  }),
};
