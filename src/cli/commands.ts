/** Opciones que admiten todas las órdenes. */
export interface GlobalOptions {
  readonly platform: string | undefined;
  readonly baseUrl: URL | undefined;
  readonly lang: string | undefined;
  readonly concurrency: number;
  readonly trace: boolean;
  readonly traceDir: string | undefined;
  readonly quiet: boolean;
}

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
