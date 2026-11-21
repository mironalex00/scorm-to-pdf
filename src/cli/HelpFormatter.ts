import type { Messages } from "../i18n/Messages.ts";
import type { CommandPlugin } from "./CommandPlugin.ts";
import { COMMON_OPTIONS, GET_OPTIONS, GLOBAL_OPTIONS, LIST_OPTIONS, SCORM_OPTIONS } from "./optionSpecs.ts";
import type { OptionSpec } from "./optionSpecs.ts";

/** Formats help using the option specs and locale catalog. */
export class HelpFormatter {
  readonly programName: string;
  private readonly messages: Messages;
  private readonly plugins: readonly CommandPlugin[];

  constructor(deps: { programName: string; messages: Messages; plugins: readonly CommandPlugin[] }) {
    this.programName = deps.programName;
    this.messages = deps.messages;
    this.plugins = deps.plugins;
  }

  format(): string {
    const { help } = this.messages;
    const program = this.programName;
    const width = this.width([
      ...GLOBAL_OPTIONS, ...SCORM_OPTIONS, ...LIST_OPTIONS, ...GET_OPTIONS,
      ...this.plugins.flatMap((plugin) => plugin.options),
    ]);
    const pluginHelp = this.plugins.map((plugin) => ({ options: plugin.options, ...plugin.describe(this.messages, program) }));
    return [
      ...help.intro({ program }),
      help.commandsHeading(),
      ...help.commandLines({ program }),
      ...pluginHelp.map(({ listing }) => listing),
      "",
      help.globalHeading(),
      ...this.block(GLOBAL_OPTIONS, width),
      "",
      help.scormHeading(),
      ...this.block(SCORM_OPTIONS, width),
      "",
      help.listHeading(),
      ...this.block(LIST_OPTIONS, width),
      "",
      help.getHeading(),
      ...this.block(GET_OPTIONS, width),
      "",
      ...pluginHelp.flatMap(({ heading, options }) => [heading, ...this.block(options, width), ""]),
      ...help.environment(),
      "",
      ...help.exitCodes(),
      "",
      ...help.examples({ program }),
      "",
    ].join("\n");
  }

  formatPlugin(plugin: CommandPlugin): string {
    const { help } = this.messages;
    const description = plugin.describe(this.messages, this.programName);
    const width = this.width([...plugin.options, ...COMMON_OPTIONS]);
    return [
      ...description.intro, "",
      description.heading, ...this.block(plugin.options, width), "",
      help.globalHeading(), ...this.block(COMMON_OPTIONS, width), "",
      description.footer, "",
    ].join("\n");
  }

  private width(specs: readonly OptionSpec[]): number {
    return Math.max(...specs.map((spec) => this.flags(spec).length));
  }

  private block(specs: readonly OptionSpec[], width: number): string[] {
    return specs.map((spec) => {
      const description = "describe" in spec ? spec.describe(this.messages) : this.messages.options[spec.name];
      return `  ${this.flags(spec).padEnd(width)}  ${description}`;
    });
  }

  private flags(spec: OptionSpec): string {
    const short = spec.short ? `-${spec.short}, ` : "    ";
    const value = spec.valueKind ? ` <${this.messages.help.values[spec.valueKind]}>` : "";
    return `${short}--${spec.name}${value}`;
  }
}
