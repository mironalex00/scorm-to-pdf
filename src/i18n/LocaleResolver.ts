import { UsageError } from "../domain/errors.ts";
import type { Messages } from "./Messages.ts";

export interface ResolvedLocale {
  readonly locale: string;
  readonly messages: Messages;
}

/**
 * Resolves the locale from --lang, SCORM_LANG, LANG, then the default. An unsupported explicit flag
 * is a usage error.
 */
export class LocaleResolver {
  private readonly catalogs: Readonly<Record<string, Messages>>;
  private readonly defaultLocale: string;

  constructor(deps: { catalogs: Readonly<Record<string, Messages>>; defaultLocale: string }) {
    this.catalogs = deps.catalogs;
    this.defaultLocale = deps.defaultLocale;
  }

  resolve(input: { flag: string | undefined; env: Readonly<Record<string, string | undefined>> }): ResolvedLocale {
    if (input.flag !== undefined) {
      const requested = this.normalize(input.flag);
      const messages = this.catalogs[requested];
      if (!messages) {
        const fallback = this.catalogs[this.defaultLocale]!;
        const supported = Object.keys(this.catalogs).join(", ");
        throw new UsageError(fallback.cli.unsupportedLocale({ locale: input.flag, supported }));
      }
      return { locale: requested, messages };
    }

    const fromEnv = [input.env.SCORM_LANG, input.env.LANG]
      .map((value) => this.normalize(value ?? ""))
      .find((locale) => this.catalogs[locale] !== undefined);
    const locale = fromEnv ?? this.defaultLocale;
    return { locale, messages: this.catalogs[locale]! };
  }

  private normalize(raw: string): string {
    return raw.split(/[_.\-@]/)[0]!.toLowerCase();
  }
}
