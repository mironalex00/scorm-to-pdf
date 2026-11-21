import { asciiAnimations } from "../plugins/ascii-fire/generatedAnimations.ts";
import { asciiFirePlugin } from "../plugins/ascii-fire/plugin.ts";
import { i18nPlugin } from "../plugins/i18n/index.ts";
import { PluginRegistry } from "../plugins/PluginRegistry.ts";

export const builtInPlugins = new PluginRegistry(i18nPlugin, [asciiFirePlugin]);
export const builtInAnimations = asciiAnimations;
