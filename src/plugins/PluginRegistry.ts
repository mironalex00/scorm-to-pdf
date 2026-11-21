import type { CommandPlugin } from "../cli/CommandPlugin.ts";
import { COMMAND_NAMES } from "../cli/optionSpecs.ts";
import type { LanguagePlugin } from "../i18n/LanguagePlugin.ts";

/** Holds the capabilities registered by the application at startup. */
export class PluginRegistry {
  readonly language: LanguagePlugin;
  readonly commands: readonly CommandPlugin[];

  constructor(language: LanguagePlugin, commands: readonly CommandPlugin[]) {
    this.language = language;
    const ids = new Set([language.id]);
    const names = new Set<string>(["scorm", ...COMMAND_NAMES]);
    for (const plugin of commands) {
      if (ids.has(plugin.id)) throw new Error(`Duplicate plugin ID: ${plugin.id}`);
      if (names.has(plugin.command)) throw new Error(`Duplicate command: ${plugin.command}`);
      ids.add(plugin.id);
      names.add(plugin.command);
    }
    this.commands = [...commands];
  }
}
