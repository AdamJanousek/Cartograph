// Usage:
//   node parser/cli.ts <directory> [--out result.json]   parse and print a summary
//   node parser/cli.ts --read result.json                read a written result back and check it

import { readFileSync, writeFileSync } from "node:fs";
import { parseRepository } from "./index.ts";
import { EDGE_KINDS, IMPORT_OUTCOMES, type ParseResult } from "./types.ts";
import { readParseResult } from "./validate.ts";

function main(args: string[]): void {
  const readIndex = args.indexOf("--read");
  if (readIndex !== -1) {
    const path = args[readIndex + 1];
    if (!path) usage();
    const result = readParseResult(readFileSync(path, "utf8"));
    print(result);
    console.log(`\nread back ${path}: shape and integrity checks passed`);
    return;
  }

  const outIndex = args.indexOf("--out");
  const out = outIndex === -1 ? null : args[outIndex + 1];
  if (outIndex !== -1 && !out) usage();
  const directory = args.find((arg, index) => !arg.startsWith("--") && (outIndex === -1 || index !== outIndex + 1));
  if (!directory) usage();

  const started = performance.now();
  const result = parseRepository(directory);
  const seconds = ((performance.now() - started) / 1000).toFixed(2);
  print(result);
  console.log(`\nparsed in ${seconds}s`);

  if (out) {
    writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`wrote ${out}`);
  }
}

function print(result: ParseResult): void {
  const { files, imports } = result.coverage;
  const folders = new Set(result.files.map((file) => file.folder));

  console.log(`root     ${result.root}`);
  console.log(`frameworks  ${result.frameworks.join(", ") || "none"}`);
  const roles = new Map<string, number>();
  for (const file of result.files) if (file.role) roles.set(file.role, (roles.get(file.role) ?? 0) + 1);
  console.log(`roles    ${[...roles].map(([role, n]) => `${role} ${n}`).join("  ") || "none"}  ·  unidentified ${result.files.filter((file) => !file.role).length}`);
  console.log(`files    found ${files.found}  parsed ${files.parsed}  skipped ${files.skipped}`);
  for (const skip of files.skips) console.log(`  skipped  ${skip.path}  ${skip.reason}: ${skip.detail}`);
  for (const dir of files.excludedDirectories) console.log(`  not entered  ${dir.path}/  ${dir.reason}`);
  console.log(`folders  ${folders.size}`);
  console.log(`edges    ${result.edges.length} (deduplicated)`);

  console.log(`\nimports  ${imports.total}`);
  console.log(row("", IMPORT_OUTCOMES.map(String)));
  for (const kind of EDGE_KINDS) {
    console.log(row(kind, IMPORT_OUTCOMES.map((outcome) => String(imports.byKind[kind][outcome]))));
  }
  console.log(row("total", IMPORT_OUTCOMES.map((outcome) => String(imports.byOutcome[outcome]))));

  for (const group of imports.reasons) {
    console.log(`\n${group.outcome} · ${group.reason} · ${group.count}`);
    for (const record of group.examples) {
      const target = record.target ? ` -> ${record.target}` : "";
      const detail = record.detail ? `  (${record.detail})` : "";
      console.log(`  ${record.from}:${record.line}  ${record.kind} ${JSON.stringify(record.specifier)}${target}${detail}`);
    }
    if (group.examples.length < group.count) console.log(`  … ${group.count - group.examples.length} more`);
  }

  const busiest = [...result.files].sort((a, b) => b.fanIn - a.fanIn).slice(0, 5);
  console.log(`\nhighest fan-in`);
  for (const file of busiest) console.log(`  ${String(file.fanIn).padStart(4)}  ${file.path}`);
}

function row(label: string, cells: string[]): string {
  return `  ${label.padEnd(16)}${cells.map((cell) => cell.padStart(12)).join("")}`;
}

function usage(): never {
  console.error("usage: node parser/cli.ts <directory> [--out result.json]\n       node parser/cli.ts --read result.json");
  process.exit(2);
}

main(process.argv.slice(2));
