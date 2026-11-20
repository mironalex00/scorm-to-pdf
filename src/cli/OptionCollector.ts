import { parseArgs } from "node:util";
import { UsageError } from "../domain/errors.ts";
import type { Messages } from "../i18n/Messages.ts";
import type { OptionSpec } from "./optionSpecs.ts";

export interface CollectedOptions {
  readonly strings: Map<string, string>;
  readonly flags: Set<string>;
  readonly positionals: string[];
}

interface OptionToken {
  readonly name: string;
  readonly rawName: string;
  readonly value: string | undefined;
  readonly inlineValue: boolean | undefined;
}

/** Lee argv contra una lista de opciones: valida valores, duplicados y desconocidas (con sugerencia). */
export class OptionCollector {
  private readonly messages: Messages;

  constructor(deps: { messages: Messages }) {
    this.messages = deps.messages;
  }

  /** Primer argumento posicional, sin validar nada: sirve para elegir la orden. */
  firstPositional(argv: readonly string[], specs: readonly OptionSpec[]): string | undefined {
    const parsed = parseArgs({ args: [...argv], options: this.config(specs), allowPositionals: true, strict: false, tokens: true });
    const first = parsed.tokens.find((token) => token.kind === "positional");
    return first?.kind === "positional" ? first.value : undefined;
  }

  collect(argv: readonly string[], specs: readonly OptionSpec[]): CollectedOptions {
    const parsed = parseArgs({ args: [...argv], options: this.config(specs), allowPositionals: true, strict: false, tokens: true });
    const known = new Map(specs.map((spec) => [spec.name as string, spec]));
    const result: CollectedOptions = { strings: new Map(), flags: new Set(), positionals: [] };
    for (const token of parsed.tokens) {
      if (token.kind === "positional") result.positionals.push(token.value);
      if (token.kind === "option") this.collectOption(token, known, result);
    }
    return result;
  }

  private config(specs: readonly OptionSpec[]): Record<string, { type: "string" | "boolean"; short?: string }> {
    const config: Record<string, { type: "string" | "boolean"; short?: string }> = {};
    for (const spec of specs) config[spec.name] = spec.short ? { type: spec.kind, short: spec.short } : { type: spec.kind };
    return config;
  }

  private collectOption(token: OptionToken, known: ReadonlyMap<string, OptionSpec>, into: CollectedOptions): void {
    const spec = known.get(token.name);
    if (!spec) throw this.unknownOption(token.name, token.rawName, known);
    if (into.strings.has(spec.name) || into.flags.has(spec.name)) {
      throw new UsageError(this.messages.cli.optionRepeated({ name: spec.name }));
    }

    if (spec.kind === "boolean") {
      if (token.inlineValue === true) throw new UsageError(this.messages.cli.optionNoValue({ name: spec.name }));
      into.flags.add(spec.name);
      return;
    }

    const value = token.value;
    const looksLikeAnotherOption = token.inlineValue === false && value?.startsWith("-");
    if (value === undefined || (value === "" && !spec.allowEmpty) || looksLikeAnotherOption) {
      throw new UsageError(this.messages.cli.optionNeedsValue({ name: spec.name }));
    }
    into.strings.set(spec.name, value);
  }

  private unknownOption(name: string, rawName: string, known: ReadonlyMap<string, OptionSpec>): UsageError {
    const suggestion = rawName.startsWith("--") ? this.closestOption(name, known) : undefined;
    const hint = suggestion ? this.messages.cli.didYouMean({ name: suggestion }) : "";
    return new UsageError(this.messages.cli.unknownOption({ raw: rawName, suggestion: hint }));
  }

  private closestOption(name: string, known: ReadonlyMap<string, OptionSpec>): string | undefined {
    let best: { name: string; distance: number } | undefined;
    for (const candidate of known.keys()) {
      const distance = this.editDistance(name, candidate);
      if (distance <= 2 && (!best || distance < best.distance)) best = { name: candidate, distance };
    }
    return best?.name;
  }

  private editDistance(a: string, b: string): number {
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
      const current = [i];
      for (let j = 1; j <= b.length; j += 1) {
        const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
        current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, substitution);
      }
      previous = current;
    }
    return previous[b.length]!;
  }
}
