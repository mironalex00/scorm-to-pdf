import { OUTPUT_OPTION } from "../../cli/optionSpecs.ts";
import type { OptionSpec } from "../../cli/optionSpecs.ts";

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
