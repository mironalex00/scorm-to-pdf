import type { LanguagePreferences } from "../../i18n/LanguagePlugin.ts";
import type { Messages } from "../../i18n/Messages.ts";

function normalize(raw: string): string {
  return raw.trim().split(/[.@]/)[0]!.replaceAll("_", "-").toLowerCase();
}

/** Resolves a locale once per invocation, then reuses the selected catalog. */
export class LocaleResolver {
  private readonly fallback: Messages;
  private readonly catalogs: ReadonlyMap<string, Messages>;
  private readonly systemLocale: () => string;

  constructor(fallback: Messages, catalogs: readonly Messages[], systemLocale: () => string) {
    this.fallback = fallback;
    this.catalogs = new Map([fallback, ...catalogs].map((catalog) => [normalize(catalog.locale), catalog]));
    this.systemLocale = systemLocale;
  }

  resolve({ flag, env }: LanguagePreferences): Messages {
    const requested = flag ?? (env.SCORM_LANG || env.LC_ALL || env.LC_MESSAGES || env.LANG || this.systemLocale());
    let locale = normalize(requested);
    for (;;) {
      const catalog = this.catalogs.get(locale);
      if (catalog) return catalog;
      const separator = locale.lastIndexOf("-");
      if (separator < 0) return this.fallback;
      locale = locale.slice(0, separator);
    }
  }
}
