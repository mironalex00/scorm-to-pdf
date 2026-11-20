import { join } from "node:path";
import type { Messages } from "../i18n/Messages.ts";
import type { FileSink, Logger } from "./ports.ts";
import type { OutputNamer } from "./OutputNamer.ts";
import type { ScormLocator } from "./ScormLocator.ts";
import type { SlidesToPdf } from "./SlidesToPdf.ts";

export interface ConversionRequest {
  readonly baseUrl: URL;
  readonly scormId: number;
  readonly entry: string;
  readonly revision: number | undefined;
  readonly outPath: string | undefined;
  readonly outDir: string;
}

export interface ConversionReport {
  readonly outputPath: string;
  readonly pages: number;
  readonly bytes: number;
  readonly revision: number;
  readonly title: string | undefined;
}

/** Coordinates conversion of a SCORM module into a saved PDF. */
export class ConvertScormToPdf {
  private readonly locator: ScormLocator;
  private readonly slides: SlidesToPdf;
  private readonly namer: OutputNamer;
  private readonly sink: FileSink;
  private readonly logger: Logger;
  private readonly messages: Messages;

  constructor(deps: {
    locator: ScormLocator;
    slides: SlidesToPdf;
    namer: OutputNamer;
    sink: FileSink;
    logger: Logger;
    messages: Messages;
  }) {
    this.messages = deps.messages;
    this.locator = deps.locator;
    this.slides = deps.slides;
    this.namer = deps.namer;
    this.sink = deps.sink;
    this.logger = deps.logger;
  }

  async execute(request: ConversionRequest): Promise<ConversionReport> {
    const located = await this.locator.locate(request);
    const deck = this.slides.parse(located.html);
    this.logger.info(
      this.messages.convert.located({
        id: String(request.scormId),
        revision: String(located.revision),
        title: deck.title ?? this.messages.common.untitled(),
      }),
    );

    const { pdf, pages } = await this.slides.render(deck, located.entryUrl);
    const target = request.outPath ?? join(request.outDir, this.namer.name({ title: deck.title, scormId: request.scormId }));
    const outputPath = await this.sink.write(target, pdf);
    return { outputPath, pages, bytes: pdf.length, revision: located.revision, title: deck.title };
  }
}
