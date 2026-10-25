import { ScormFormatError, errorMessage } from "../domain/errors.ts";
import type { Messages } from "../i18n/Messages.ts";

export interface Slide {
  readonly src: string;
  readonly title: string;
}

export interface Deck {
  readonly title: string | undefined;
  readonly slides: readonly Slide[];
}

// El SCORM define SLIDES como un array compatible con JSON. Se ancla el final en
// «const N» para que los corchetes dentro del texto de las diapositivas no importen.
const SLIDES_ARRAY = /const\s+SLIDES\s*=\s*(\[[\s\S]*?\])\s*;\s*(?=const\s+N\b)/;
const TITLE_TAG = /<title>([\s\S]*?)<\/title>/i;

export class SlideListParser {
  private readonly maxSlides: number;
  private readonly messages: Messages;

  constructor(settings: { maxSlides: number; messages: Messages }) {
    this.maxSlides = settings.maxSlides;
    this.messages = settings.messages;
  }

  parse(html: string): Deck {
    const title = this.extractTitle(html);
    const match = SLIDES_ARRAY.exec(html);
    if (!match) {
      throw new ScormFormatError(this.messages.slides.arrayMissing({ title: title ?? this.messages.common.untitled() }));
    }

    const raw = this.parseJson(match[1]!);
    if (raw.length === 0) throw new ScormFormatError(this.messages.slides.arrayEmpty());
    if (raw.length > this.maxSlides) {
      throw new ScormFormatError(
        this.messages.slides.tooMany({ count: String(raw.length), max: String(this.maxSlides) }),
      );
    }
    return { title, slides: raw.map((entry, index) => this.toSlide(entry, index + 1)) };
  }

  private extractTitle(html: string): string | undefined {
    const text = TITLE_TAG.exec(html)?.[1]?.replace(/\s+/g, " ").trim();
    return text ? text : undefined;
  }

  private parseJson(source: string): unknown[] {
    try {
      return JSON.parse(source) as unknown[];
    } catch (error) {
      throw new ScormFormatError(this.messages.slides.badJson({ detail: errorMessage(error) }), { cause: error });
    }
  }

  private toSlide(entry: unknown, position: number): Slide {
    const candidate = (entry ?? {}) as { src?: unknown; title?: unknown };
    if (typeof candidate.src !== "string" || candidate.src.trim() === "") {
      throw new ScormFormatError(this.messages.slides.badSrc({ position: String(position) }));
    }
    return { src: candidate.src, title: typeof candidate.title === "string" ? candidate.title : "" };
  }
}
