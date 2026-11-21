import type { Messages } from "./Messages.ts";

export interface LanguagePreferences {
  readonly flag?: string | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export interface LanguagePlugin {
  readonly id: string;
  readonly fallback: Messages;
  resolve(preferences: LanguagePreferences): Messages;
}
