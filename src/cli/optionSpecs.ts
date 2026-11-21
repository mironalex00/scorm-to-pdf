import type { Messages } from "../i18n/Messages.ts";
import type { OptionName } from "./optionNames.ts";

export type ValueKind = "file" | "folder" | "path" | "list" | "number" | "text" | "url" | "code" | "platform";

interface OptionShape {
  readonly name: string;
  readonly short?: string;
  readonly kind: "string" | "boolean";
  readonly valueKind?: ValueKind;
  readonly allowEmpty?: boolean;
}

export interface CatalogOptionSpec extends OptionShape {
  readonly name: OptionName;
}

export interface PluginOptionSpec extends OptionShape {
  describe(messages: Messages): string;
}

export type OptionSpec = CatalogOptionSpec | PluginOptionSpec;

export type CommandName = "scorm" | "courses" | "items" | "get" | "diagnose" | "tui";

export const CLI_DEFAULTS = {
  entry: "index.html",
  concurrency: 6,
  outDir: ".",
  dest: ".",
} as const;

export const COMMON_OPTIONS: readonly CatalogOptionSpec[] = [
  { name: "lang", kind: "string", valueKind: "code" },
  { name: "trace", kind: "boolean" },
  { name: "trace-dir", kind: "string", valueKind: "folder" },
  { name: "quiet", short: "q", kind: "boolean" },
  { name: "help", short: "h", kind: "boolean" },
  { name: "version", short: "v", kind: "boolean" },
];

/** Global options for Moodle commands. */
export const GLOBAL_OPTIONS: readonly CatalogOptionSpec[] = [
  { name: "platform", kind: "string", valueKind: "platform" },
  { name: "base-url", kind: "string", valueKind: "url" },
  { name: "concurrency", short: "c", kind: "string", valueKind: "number" },
  ...COMMON_OPTIONS,
];

export const OUTPUT_OPTION: CatalogOptionSpec = { name: "out", short: "o", kind: "string", valueKind: "file" };

export const SCORM_OPTIONS: readonly CatalogOptionSpec[] = [
  OUTPUT_OPTION,
  { name: "out-dir", short: "d", kind: "string", valueKind: "folder" },
  { name: "entry", kind: "string", valueKind: "path" },
  { name: "revision", kind: "string", valueKind: "number" },
];

export const LIST_OPTIONS: readonly CatalogOptionSpec[] = [{ name: "json", kind: "boolean" }];

export const GET_OPTIONS: readonly CatalogOptionSpec[] = [
  { name: "week", kind: "string", valueKind: "list" },
  { name: "item", kind: "string", valueKind: "list" },
  { name: "all", kind: "boolean" },
  { name: "dest", short: "d", kind: "string", valueKind: "folder" },
];

/** Options declared by each command. */
export const COMMAND_OPTIONS: Readonly<Record<CommandName, readonly CatalogOptionSpec[]>> = {
  scorm: SCORM_OPTIONS,
  courses: LIST_OPTIONS,
  items: LIST_OPTIONS,
  get: GET_OPTIONS,
  diagnose: [],
  tui: [],
};

export const COMMAND_NAMES: readonly CommandName[] = ["courses", "items", "get", "diagnose", "tui"];
