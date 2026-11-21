import type { CollectedOptions } from "../../cli/OptionCollector.ts";
import { parseInteger } from "../../cli/optionValues.ts";
import { UsageError } from "../../domain/errors.ts";
import type { Messages } from "../../i18n/Messages.ts";
import type { ConversionOptions } from "./index.ts";
import { ASCII_OPTIONS } from "./options.ts";

export type AsciiRequest =
  | { readonly kind: "prepare" }
  | { readonly kind: "convert"; readonly input: string; readonly options: Omit<ConversionOptions, "signal"> };

export function parseAsciiRequest(collected: CollectedOptions, positionals: readonly string[], messages: Messages): AsciiRequest {
  const { flags, strings } = collected;
  if (flags.has("prepare")) {
    if (positionals.length || ASCII_OPTIONS.some(({ name }) => name !== "prepare" && (strings.has(name) || flags.has(name)))) {
      throw new UsageError(messages.cli.asciiPrepareOnly());
    }
    return { kind: "prepare" };
  }
  if (positionals.length === 0 || !positionals[0]!.trim()) throw new UsageError(messages.cli.asciiMissingInput());
  if (positionals.length > 1) throw new UsageError(messages.cli.asciiTooManyInputs());

  const integer = (name: string, max: number) => {
    const raw = strings.get(name);
    return raw === undefined ? undefined : parseInteger(messages, "--" + name, raw, 1, max, true);
  };
  const decimal = (name: string, minimum: "positive" | "nonnegative", maximum = Infinity) => {
    const raw = strings.get(name);
    if (raw === undefined) return undefined;
    const value = Number(raw);
    if (!raw.trim() || !Number.isFinite(value) || value > maximum || (minimum === "positive" ? value <= 0 : value < 0)) {
      throw new UsageError(messages.cli.asciiInvalidNumber({ name, raw }));
    }
    return value;
  };
  return {
    kind: "convert",
    input: positionals[0]!,
    options: {
      out: strings.get("out"), cols: integer("cols", 500), scale: integer("scale", 8),
      maxFrames: integer("max-frames", 10_000), fps: decimal("fps", "positive", 60),
      gamma: decimal("gamma", "positive"), tone: decimal("tone", "nonnegative"),
      aspect: decimal("aspect", "positive"), chars: strings.get("chars"),
      bg: flags.has("bg"), color: flags.has("color"), invert: flags.has("invert"),
      loop: flags.has("loop"), mute: flags.has("mute"),
    },
  };
}
