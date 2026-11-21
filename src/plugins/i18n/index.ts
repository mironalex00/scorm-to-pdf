import type { LanguagePlugin } from "../../i18n/LanguagePlugin.ts";
import { en } from "../../i18n/en.ts";
import { es } from "./es.ts";
import { LocaleResolver } from "./LocaleResolver.ts";
import { ro } from "./ro.ts";

const resolver = new LocaleResolver(en, [es, ro], () => Intl.DateTimeFormat().resolvedOptions().locale);

export const i18nPlugin: LanguagePlugin = {
  id: "i18n",
  fallback: en,
  resolve: (preferences) => resolver.resolve(preferences),
};
