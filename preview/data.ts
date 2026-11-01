import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readParseResult } from "../parser/validate.ts";

// Scaffolding. A parse of excalidraw/excalidraw at 8bcdca45, checked in so the
// interface can be built with no account, database or network. It goes away
// once analyses are stored. It's read through the parser's own validator, so
// the preview sees exactly the contract everything else will, unreshaped.
export const previewResult = readParseResult(
  readFileSync(join(process.cwd(), "preview/excalidraw.json"), "utf8"),
);

export const previewName = "excalidraw/excalidraw";
