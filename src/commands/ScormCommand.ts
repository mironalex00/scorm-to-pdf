import type { ConvertScormToPdf, ConversionRequest } from "../application/ConvertScormToPdf.ts";
import type { Logger } from "../application/ports.ts";
import type { Messages } from "../i18n/Messages.ts";
import type { Command } from "./Command.ts";

const MIB = 1024 * 1024;

/** Converts the slides in a single SCORM module into a PDF. */
export class ScormCommand implements Command {
  private readonly convert: ConvertScormToPdf;
  private readonly request: ConversionRequest;
  private readonly logger: Logger;
  private readonly messages: Messages;

  constructor(deps: { convert: ConvertScormToPdf; request: ConversionRequest; logger: Logger; messages: Messages }) {
    this.convert = deps.convert;
    this.request = deps.request;
    this.logger = deps.logger;
    this.messages = deps.messages;
  }

  async run(): Promise<number> {
    const report = await this.convert.execute(this.request);
    this.logger.info(this.messages.app.done({ pages: String(report.pages), mib: (report.bytes / MIB).toFixed(2) }));
    this.logger.result(report.outputPath);
    return 0;
  }
}
