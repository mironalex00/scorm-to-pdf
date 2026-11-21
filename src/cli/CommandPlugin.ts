import type { HttpClient } from "../application/ports.ts";
import type { Messages } from "../i18n/Messages.ts";
import type { OutputStream } from "../infra/ConsoleLogger.ts";
import type { CollectedOptions } from "./OptionCollector.ts";
import type { OptionSpec } from "./optionSpecs.ts";

export interface PluginCommandContext {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdout: OutputStream;
  readonly messages: Messages;
  readonly http: HttpClient | undefined;
  readonly signal: AbortSignal;
  readonly quiet: boolean;
}

export interface PluginCommand {
  readonly action: string;
  run(context: PluginCommandContext): Promise<number | void>;
}

export interface PluginHelp {
  readonly listing: string;
  readonly intro: readonly string[];
  readonly heading: string;
  readonly footer: string;
}

export interface CommandPlugin {
  readonly id: string;
  readonly command: string;
  readonly options: readonly OptionSpec[];
  readonly environmentKeys: readonly string[];
  describe(messages: Messages, program: string): PluginHelp;
  parse(options: CollectedOptions, positionals: readonly string[], messages: Messages): PluginCommand;
}
