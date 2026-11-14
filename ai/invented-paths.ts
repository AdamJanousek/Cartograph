import { posix } from "node:path";

// The invented-path check. Every path-shaped token in an explanation is tested
// against the exact set of paths the model was shown; anything else was
// invented. Set membership has an exact answer, so this is code, never a model.
//
// What counts as path-shaped, decided once here:
// - In inline code, a token with a slash whose last segment has a file
//   extension (`src/app.ts`), or whose first segment is a top-level folder of
//   a shown path (`src/made-up`). An extensionless token that doesn't start in
//   the repository (`next/navigation`, `@nestjs/common`) is a package, not a
//   path, and isn't checked.
// - A token with no slash only when it ends in an extension the shown files
//   use (`app.ts`), since `res.json` and `config.port` are code, not files.
// - In prose, the same, but only with a slash in it, so "Node.js" isn't read
//   as a file.
// A shown path matches as written, by its folder (every ancestor of a shown
// file was shown with it), by its bare file name, or as a `./` or `../` path
// from the thing being explained.

export const INVENTED_PATHS_KEY = "no_invented_paths";

export interface PathCheck {
  /** Every distinct path-shaped token found, as written. */
  checked: string[];
  /** The ones that match nothing the model was shown. Empty means a pass. */
  invented: string[];
}

const SEGMENT = /^[\w@.()[\]{}+~$-]+$/;
const EXTENSION = /[^.]\.[a-z][a-z0-9]{0,5}$/i;
// Prose only: inline code is taken as written, since `_app.tsx` and
// `[id]/page.tsx` start with what would otherwise be stripped.
const EDGE_PUNCTUATION = /^[("'“‘[*]+|[)"'”’\].,;:!?*]+$/g;

/**
 * `shown` is every path put in the prompt. `base` is the folder the
 * explained thing sits in, for resolving relative paths.
 */
export function checkInventedPaths(text: string, shown: Iterable<string>, base: string): PathCheck {
  const known = new Set<string>();
  const names = new Set<string>();
  const roots = new Set<string>();
  const extensions = new Set<string>();
  for (const path of shown) {
    const extension = posix.extname(path);
    if (extension) extensions.add(extension);
    known.add(path);
    names.add(posix.basename(path));
    const segments = path.split("/");
    roots.add(segments[0]);
    for (let end = 1; end < segments.length; end++) known.add(segments.slice(0, end).join("/"));
  }

  const tokens = new Set<string>();
  const parts = text.split(/(`[^`\n]+`)/);
  parts.forEach((part, index) => {
    if (index % 2 === 1) {
      const token = withoutLine(part.slice(1, -1).trim());
      if (isPathShaped(token, roots, extensions)) tokens.add(token);
      return;
    }
    for (const word of part.split(/\s+/)) {
      const token = withoutLine(word.replace(EDGE_PUNCTUATION, ""));
      if (token.includes("/") && isPathShaped(token, roots, extensions)) tokens.add(token);
    }
  });

  const checked = [...tokens];
  const invented = checked.filter((token) => {
    const path = resolve(token, base);
    if (known.has(path)) return false;
    // A bare file name names a shown file, ambiguously perhaps, but not falsely.
    if (!path.includes("/") && names.has(path)) return false;
    return true;
  });
  return { checked, invented };
}

/** Drops a line reference: src/app.ts:12 or src/app.ts#L12. */
function withoutLine(token: string): string {
  return token.replace(/(?::\d+(?:-\d+)?|#L\d+(?:-L?\d+)?)$/, "");
}

function isPathShaped(token: string, roots: ReadonlySet<string>, extensions: ReadonlySet<string>): boolean {
  if (!token || token.includes("://")) return false;
  const segments = token.replace(/\/$/, "").split("/");
  if (!segments.every((segment) => SEGMENT.test(segment))) return false;
  if (segments.length < 2) return EXTENSION.test(token) && extensions.has(posix.extname(token));
  if (EXTENSION.test(segments[segments.length - 1])) return true;
  const first = segments[0] === "." || segments[0] === ".." ? null : segments[0];
  return first === null || roots.has(first);
}

function resolve(token: string, base: string): string {
  const path = token.replace(/\/$/, "");
  if (!path.startsWith("./") && !path.startsWith("../")) return path;
  return posix.normalize(posix.join(base, path));
}
