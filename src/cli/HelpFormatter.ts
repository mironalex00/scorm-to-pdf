import type { Messages } from "../i18n/Messages.ts";
import { GET_OPTIONS, GLOBAL_OPTIONS, LIST_OPTIONS, SCORM_OPTIONS } from "./optionSpecs.ts";
import type { OptionSpec } from "./optionSpecs.ts";

/** Genera la ayuda desde las especificaciones de opciones y el catálogo de mensajes. */
export class HelpFormatter {
  readonly programName: string;
  private readonly messages: Messages;

  constructor(deps: { programName: string; messages: Messages }) {
    this.programName = deps.programName;
    this.messages = deps.messages;
  }

  format(): string {
    const { help } = this.messages;
    const program = this.programName;
    const width = Math.max(...[...GLOBAL_OPTIONS, ...SCORM_OPTIONS, ...LIST_OPTIONS, ...GET_OPTIONS].map((spec) => this.flags(spec).length));
    return [
      ...help.intro({ program }),
      help.commandsHeading(),
      ...help.commandLines({ program }),
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
      ...help.environment(),
      "",
      ...help.exitCodes(),
      "",
      ...help.examples({ program }),
      "",
    ].join("\n");
  }

  private block(specs: readonly OptionSpec[], width: number): string[] {
    return specs.map((spec) => `  ${this.flags(spec).padEnd(width)}  ${this.messages.options[spec.name]}`);
  }

  private flags(spec: OptionSpec): string {
    const short = spec.short ? `-${spec.short}, ` : "    ";
    const value = spec.valueKind ? ` <${this.messages.help.values[spec.valueKind]}>` : "";
    return `${short}--${spec.name}${value}`;
  }
}
