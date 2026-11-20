import type { Messages } from "../i18n/Messages.ts";
import type { PdfBuilder } from "../pdf/PdfBuilder.ts";
import type { Logger } from "./ports.ts";
import type { SlideDownloader } from "./SlideDownloader.ts";
import type { Deck, SlideListParser } from "./SlideListParser.ts";

export interface RenderedPdf {
  readonly pdf: Uint8Array;
  readonly pages: number;
}

/** Parses the deck, downloads its images, and builds the PDF. */
export class SlidesToPdf {
  private readonly parser: SlideListParser;
  private readonly downloader: SlideDownloader;
  private readonly pdfBuilder: PdfBuilder;
  private readonly logger: Logger;
  private readonly messages: Messages;

  constructor(deps: {
    parser: SlideListParser;
    downloader: SlideDownloader;
    pdfBuilder: PdfBuilder;
    logger: Logger;
    messages: Messages;
  }) {
    this.parser = deps.parser;
    this.downloader = deps.downloader;
    this.pdfBuilder = deps.pdfBuilder;
    this.logger = deps.logger;
    this.messages = deps.messages;
  }

  parse(html: string): Deck {
    return this.parser.parse(html);
  }

  async render(deck: Deck, entryUrl: URL): Promise<RenderedPdf> {
    this.logger.info(this.messages.convert.slidesFound({ count: String(deck.slides.length) }));
    const images = await this.downloader.download(deck.slides, entryUrl);
    this.logger.info(this.messages.convert.buildingPdf());
    return { pdf: this.pdfBuilder.build(images), pages: deck.slides.length };
  }
}
