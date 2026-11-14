import type { Edge, FileNode } from "../parser/types.ts";
import { MODEL, model, textOf } from "./client.ts";

// The explanation prompt, apart from where its facts come from: the app reads
// them from the database, the evals from a fresh parse. Both build exactly
// this, so an experiment measures the prompt that ships.

/** Characters of a file's source the model sees. Past this it's told the rest was cut. */
const SOURCE_CHARS = 40_000;

// Exactly three pieces of formatting, because the pane renders exactly three.
// Forbidding all formatting doesn't survive contact: models emit it anyway and
// it shows up as raw backticks. Headings are out because the pane is narrow.
const FORMAT = [
  "Write plain prose: two or three short paragraphs, and at most one short bulleted list.",
  "The only formatting allowed is `inline code`, **bold**, and bullets starting with \"- \". No headings, no numbered lists, no code blocks, no links, no tables.",
  "Write every file or folder you mention as its full repository path in inline code, exactly as given below. Mention only paths that appear below.",
];

const STANCE = [
  "You explain a codebase to a developer reading it for the first time. You don't review it: no judgements of quality, no suggestions, no risks or issues.",
  "The connections listed below come from a parser and are complete. Don't claim any connection that isn't listed, and don't speculate about files you weren't shown.",
];

export const EXPLAIN_SYSTEM = [...STANCE, ...FORMAT].join("\n");

/** What the parser knows about a repository, which is everything the model may be told. */
export interface Facts {
  repository: { owner: string; name: string };
  frameworks: readonly string[];
  edges: readonly Edge[];
  byPath: ReadonlyMap<string, FileNode>;
}

export interface Prompt {
  user: string;
  /** Every path the prompt hands the model: the set the invented-path check tests against. */
  shown: string[];
  /** The folder the explained thing sits in, for paths the model writes relative to it. */
  base: string;
}

export function filePrompt(facts: Facts, path: string, source: string): Prompt {
  const file = facts.byPath.get(path);
  if (!file) throw new Error(`${path} isn't in this analysis.`);
  const imports = facts.edges.filter((edge) => edge.from === path);
  const importers = facts.edges.filter((edge) => edge.to === path);
  const neighbour = (other: string, edge: Edge) =>
    `- \`${other}\`${roleOf(facts.byPath.get(other))} via ${edge.kinds.join(", ")}${edge.typeOnly ? ", types only" : ""}`;

  const user = [
    header(facts),
    `File: \`${file.path}\`${roleOf(file)}, ${file.lines} lines.`,
    "",
    `It imports ${imports.length} file${imports.length === 1 ? "" : "s"} in this repository:`,
    ...(imports.length ? imports.map((edge) => neighbour(edge.to, edge)) : ["(none)"]),
    "",
    `It is imported by ${importers.length} file${importers.length === 1 ? "" : "s"}:`,
    ...(importers.length ? importers.map((edge) => neighbour(edge.from, edge)) : ["(none)"]),
    "",
    "Its source:",
    "```",
    source.slice(0, SOURCE_CHARS),
    "```",
    source.length > SOURCE_CHARS ? `(The source was cut at ${SOURCE_CHARS} characters; it continues.)` : "",
    "",
    "Explain what this file does and the part it plays among the files around it: what it gives the files that import it, and what it relies on from the ones it imports.",
  ].join("\n");

  const shown = [path, ...imports.map((edge) => edge.to), ...importers.map((edge) => edge.from)];
  return { user, shown: [...new Set(shown)], base: file.folder };
}

/** A folded folder: the box on the map, holding `files`. */
export function folderPrompt(facts: Facts, folder: { id: string; files: readonly string[] }): Prompt {
  const inside = new Set(folder.files);
  const incoming = facts.edges.filter((edge) => !inside.has(edge.from) && inside.has(edge.to));
  const outgoing = facts.edges.filter((edge) => inside.has(edge.from) && !inside.has(edge.to));
  const by = (edges: Edge[], key: "from" | "to") => {
    const grouped = new Map<string, string[]>();
    for (const edge of edges) {
      const other = key === "to" ? edge.from : edge.to;
      (grouped.get(edge[key]) ?? grouped.set(edge[key], []).get(edge[key])!).push(other);
    }
    return [...grouped].sort((a, b) => b[1].length - a[1].length);
  };
  const label = folder.id === "." ? "the repository root" : `\`${folder.id}\``;

  const user = [
    header(facts),
    `Folder: ${label}, shown on the map as one box holding ${folder.files.length} files (subfolders too small to draw on their own are folded into it).`,
    "",
    "Its files:",
    ...folder.files.map((path) => {
      const file = facts.byPath.get(path)!;
      return `- \`${path}\`${roleOf(file)}, ${file.lines} lines, imported by ${file.fanIn}, imports ${file.fanOut}`;
    }),
    "",
    `${incoming.length} connections point into it from outside, from ${new Set(incoming.map((e) => e.from)).size} files. By the file inside they reach:`,
    ...(incoming.length ? by(incoming, "to").map(([to, from]) => `- \`${to}\` ← ${from.map((p) => `\`${p}\``).join(", ")}`) : ["(none)"]),
    "",
    `${outgoing.length} connections leave it. By the file inside they start from:`,
    ...(outgoing.length ? by(outgoing, "from").map(([from, to]) => `- \`${from}\` → ${to.map((p) => `\`${p}\``).join(", ")}`) : ["(none)"]),
    "",
    "Explain this folder as a whole, not any one file in it: what it holds, what part it plays in the repository, and why the files that point at it depend on it.",
  ].join("\n");

  const shown = [
    ...(folder.id === "." ? [] : [folder.id]),
    ...folder.files,
    ...incoming.map((edge) => edge.from),
    ...outgoing.map((edge) => edge.to),
  ];
  return { user, shown: [...new Set(shown)], base: folder.id };
}

/** One explanation. `system` is the shipped prompt unless an experiment says otherwise. */
export async function completeExplanation(user: string, system: string = EXPLAIN_SYSTEM): Promise<string> {
  const completion = await model().chat.completions.create({
    model: MODEL.explain,
    max_tokens: 1200,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  return textOf(completion);
}

function header(facts: Facts): string {
  return `Repository: ${facts.repository.owner}/${facts.repository.name}. Frameworks: ${facts.frameworks.join(", ") || "none detected"}.`;
}

function roleOf(file: FileNode | undefined): string {
  return file?.role ? ` (${file.role})` : "";
}
