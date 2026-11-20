import type { ConversionOptions } from "../extensions/ascii/index.ts";

export interface CommonOptions {
  readonly lang: string | undefined;
  readonly trace: boolean;
  readonly traceDir: string | undefined;
  readonly quiet: boolean;
}

/** Opciones adicionales para las órdenes que consultan Moodle. */
export interface GlobalOptions extends CommonOptions {
  readonly platform: string | undefined;
  readonly baseUrl: URL | undefined;
  readonly concurrency: number;
}

export type AsciiRequest =
  | { readonly kind: "prepare" }
  | { readonly kind: "convert"; readonly input: string; readonly options: Omit<ConversionOptions, "signal"> };

export interface ScormOptions {
  readonly scormId: number;
  readonly entry: string;
  readonly revision: number | undefined;
  readonly outPath: string | undefined;
  readonly outDir: string;
}

export type CliCommand =
  | { readonly kind: "help"; readonly text: string }
  | { readonly kind: "version"; readonly text: string }
  | { readonly kind: "ascii"; readonly global: CommonOptions; readonly request: AsciiRequest }
  | { readonly kind: "scorm"; readonly global: GlobalOptions; readonly scorm: ScormOptions }
  | { readonly kind: "courses"; readonly global: GlobalOptions; readonly json: boolean }
  | { readonly kind: "items"; readonly global: GlobalOptions; readonly course: string; readonly json: boolean }
  | {
      readonly kind: "get";
      readonly global: GlobalOptions;
      readonly course: string;
      readonly weeks: readonly number[] | undefined;
      readonly items: readonly string[] | undefined;
      readonly all: boolean;
      readonly dest: string;
    }
  | { readonly kind: "diagnose"; readonly global: GlobalOptions }
  | { readonly kind: "tui"; readonly global: GlobalOptions };

export type MoodleCommand = Exclude<CliCommand, { kind: "help" | "version" | "ascii" }>;
