import { errorMessage } from "../domain/errors.ts";
import type { Messages } from "../i18n/Messages.ts";
import type { BatchReport } from "./BatchDownloader.ts";
import type { Logger } from "./ports.ts";

/** Presenta el resultado de un lote y calcula el código de salida: 0 éxito, 3 sesión, 1 otros fallos. */
export class ReportPrinter {
  private readonly logger: Logger;
  private readonly messages: Messages;

  constructor(deps: { logger: Logger; messages: Messages }) {
    this.logger = deps.logger;
    this.messages = deps.messages;
  }

  print(report: BatchReport): number {
    const { commands } = this.messages;
    for (const outcome of report.outcomes) {
      if (outcome.status === "downloaded") this.logger.result(outcome.path);
      if (outcome.status === "skipped") this.logger.info(commands.skipped({ path: outcome.path }));
      if (outcome.status === "failed") {
        this.logger.warn(commands.failed({ name: outcome.item.name, detail: errorMessage(outcome.error) }));
      }
    }
    if (report.aborted) this.logger.warn(commands.abortedBySession());
    this.logger.info(
      commands.summary({
        downloaded: String(report.downloaded),
        skipped: String(report.skipped),
        failed: String(report.failed),
      }),
    );
    return this.exitCode(report);
  }

  exitCode(report: BatchReport): number {
    if (report.outcomes.some((outcome) => outcome.status === "failed" && outcome.authentication)) return 3;
    return report.failed > 0 ? 1 : 0;
  }
}
