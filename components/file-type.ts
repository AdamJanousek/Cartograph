import { type FileType, fileType } from "@/graph/categories";

// One hue per family, so related types read as related: TypeScript violets,
// TSX pink, JavaScript teals, JSX red. Blue, green and yellow are taken
// by selection and direction, so no type uses them.
const COLOUR: Record<FileType, string> = {
  ".ts": "var(--kind-ts)",
  ".mts": "var(--kind-ts-module)",
  ".cts": "var(--kind-ts-module)",
  ".d.ts": "var(--kind-dts)",
  ".tsx": "var(--kind-tsx)",
  ".js": "var(--kind-js)",
  ".mjs": "var(--kind-js-module)",
  ".cjs": "var(--kind-js-module)",
  ".jsx": "var(--kind-jsx)",
  other: "var(--kind-other)",
};

export function typeColour(type: FileType): string {
  return COLOUR[type];
}

/** The colour of the type a file path ends in. */
export function pathColour(path: string): string {
  return COLOUR[fileType(path)];
}
