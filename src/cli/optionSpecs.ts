import type { OptionName } from "./optionNames.ts";

export type ValueKind = "file" | "folder" | "path" | "list" | "number" | "text" | "url" | "code" | "platform";

export interface OptionSpec {
  readonly name: OptionName;
  readonly short?: string;
  readonly kind: "string" | "boolean";
  readonly valueKind?: ValueKind;
  readonly allowEmpty?: boolean;
}

export type CommandName = "scorm" | "courses" | "items" | "get" | "diagnose" | "tui" | "ascii";

export const CLI_DEFAULTS = {
  entry: "index.html",
  concurrency: 6,
  outDir: ".",
  dest: ".",
} as const;

/** Options shared by all commands. */
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

const OUTPUT_OPTION: OptionSpec = { name: "out", short: "o", kind: "string", valueKind: "file" };

export const SCORM_OPTIONS: readonly OptionSpec[] = [
  OUTPUT_OPTION,
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

export const ASCII_GLOBAL_OPTIONS = GLOBAL_OPTIONS.filter((spec) =>
  spec.name !== "platform" && spec.name !== "base-url" && spec.name !== "concurrency",
);

export const ASCII_OPTIONS: readonly OptionSpec[] = [
  { name: "prepare", kind: "boolean" },
  OUTPUT_OPTION,
  { name: "cols", short: "w", kind: "string", valueKind: "number" },
  { name: "fps", kind: "string", valueKind: "number" },
  { name: "scale", kind: "string", valueKind: "number" },
  { name: "gamma", kind: "string", valueKind: "number" },
  { name: "tone", kind: "string", valueKind: "number" },
  { name: "aspect", kind: "string", valueKind: "number" },
  { name: "chars", kind: "string", valueKind: "text", allowEmpty: true },
  { name: "max-frames", kind: "string", valueKind: "number" },
  { name: "color", kind: "boolean" },
  { name: "bg", kind: "boolean" },
  { name: "invert", kind: "boolean" },
  { name: "loop", kind: "boolean" },
  { name: "mute", kind: "boolean" },
];

/** Options declared by each command. */
export const COMMAND_OPTIONS: Readonly<Record<CommandName, readonly OptionSpec[]>> = {
  scorm: SCORM_OPTIONS,
  courses: LIST_OPTIONS,
  items: LIST_OPTIONS,
  get: GET_OPTIONS,
  diagnose: [],
  tui: [],
  ascii: ASCII_OPTIONS,
};

export const COMMAND_NAMES: readonly CommandName[] = ["courses", "items", "get", "diagnose", "tui", "ascii"];
