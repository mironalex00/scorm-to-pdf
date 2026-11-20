import type { Messages } from "../i18n/Messages.ts";
import { ASCII_GLOBAL_OPTIONS, ASCII_OPTIONS, GET_OPTIONS, GLOBAL_OPTIONS, LIST_OPTIONS, SCORM_OPTIONS } from "./optionSpecs.ts";
import type { OptionSpec } from "./optionSpecs.ts";

/** Formats help using the option specs and locale catalog. */
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
    const width = this.width([...GLOBAL_OPTIONS, ...SCORM_OPTIONS, ...LIST_OPTIONS, ...GET_OPTIONS, ...ASCII_OPTIONS]);
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
      help.asciiHeading(),
      ...this.block(ASCII_OPTIONS, width),
      "",
      ...help.environment(),
      "",
      ...help.exitCodes(),
      "",
      ...help.examples({ program }),
      "",
    ].join("\n");
  }

  formatAscii(): string {
    const { help } = this.messages;
    const width = this.width([...ASCII_OPTIONS, ...ASCII_GLOBAL_OPTIONS]);
    return [
      ...help.asciiIntro({ program: this.programName }), "",
      help.asciiHeading(), ...this.block(ASCII_OPTIONS, width), "",
      help.globalHeading(), ...this.block(ASCII_GLOBAL_OPTIONS, width), "",
      help.asciiEnvironment(), "",
    ].join("\n");
  }

  private width(specs: readonly OptionSpec[]): number {
    return Math.max(...specs.map((spec) => this.flags(spec).length));
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
