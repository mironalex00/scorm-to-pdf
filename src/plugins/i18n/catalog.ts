import { en } from "../../i18n/en.ts";
import type { Messages } from "../../i18n/Messages.ts";

type MessageSection = Exclude<keyof Messages, "locale">;
type Translations = { readonly [Section in MessageSection]?: Partial<Messages[Section]> };

export function createCatalog(locale: string, translations: Translations): Messages {
  const catalog: Messages = { ...en, locale };
  for (const section of Object.keys(translations) as MessageSection[]) {
    Object.assign(catalog, { [section]: { ...en[section], ...translations[section] } });
  }
  return catalog;
}
