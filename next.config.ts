import type { NextConfig } from "next";
import { assertServerEnv } from "./utils/env";

// Importing utils/env validates the public values; this checks the rest. Both
// throw while the config loads, so `next dev` and `next build` refuse to start.
assertServerEnv();

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
