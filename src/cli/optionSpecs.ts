import type { OptionName } from "./optionNames.ts";

export type ValueKind = "file" | "folder" | "path" | "list" | "number" | "url" | "code" | "platform";

export interface OptionSpec {
  readonly name: OptionName;
  readonly short?: string;
  readonly kind: "string" | "boolean";
  readonly valueKind?: ValueKind;
}

export type CommandName = "scorm" | "courses" | "items" | "get" | "diagnose" | "tui";

export const CLI_DEFAULTS = {
  entry: "index.html",
  concurrency: 6,
  outDir: ".",
  dest: ".",
} as const;

/** Opciones que admiten todas las órdenes. */
export const GLOBAL_OPTIONS: readonly OptionSpec[] = [
  { name: "platform", kind: "string", valueKind: "platform" },
  { name: "base-url", kind: "string", valueKind: "url" },
  { name: "lang", kind: "string", valueKind: "code" },
  { name: "concurrency", short: "c", kind: "string", valueKind: "number" },
  { name: "trace", kind: "boolean" },
  { name: "trace-dir", kind: "string", valueKind: "folder" },
  { name: "quiet", short: "q", kind: "boolean" },
  { name: "help", short: "h", kind: "boolean" },
  { name: "version", short: "v", kind: "boolean" },
];

export const SCORM_OPTIONS: readonly OptionSpec[] = [
  { name: "out", short: "o", kind: "string", valueKind: "file" },
  { name: "out-dir", short: "d", kind: "string", valueKind: "folder" },
  { name: "entry", kind: "string", valueKind: "path" },
  { name: "revision", kind: "string", valueKind: "number" },
];

export const LIST_OPTIONS: readonly OptionSpec[] = [{ name: "json", kind: "boolean" }];

export const GET_OPTIONS: readonly OptionSpec[] = [
  { name: "week", kind: "string", valueKind: "list" },
  { name: "item", kind: "string", valueKind: "list" },
  { name: "all", kind: "boolean" },
  { name: "dest", short: "d", kind: "string", valueKind: "folder" },
];

/** Opciones propias de cada orden, además de las generales. */
export const COMMAND_OPTIONS: Readonly<Record<CommandName, readonly OptionSpec[]>> = {
  scorm: SCORM_OPTIONS,
  courses: LIST_OPTIONS,
  items: LIST_OPTIONS,
  get: GET_OPTIONS,
  diagnose: [],
  tui: [],
};

export const COMMAND_NAMES: readonly CommandName[] = ["courses", "items", "get", "diagnose", "tui"];
