import { existsSync } from "node:fs";
import { join } from "node:path";

// The environment `next dev` sees, for scripts that run outside it. Same
// files, same order (most specific wins) and, like Next, never overriding a
// variable that's already set. Import this before anything that reads
// process.env at load time: ai/client.ts decides whether tracing is on when
// it's first imported.

const root = join(import.meta.dirname, "..");

for (const file of [".env.development.local", ".env.local", ".env.development", ".env"]) {
  const path = join(root, file);
  if (existsSync(path)) process.loadEnvFile(path);
}
