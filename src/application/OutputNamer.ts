const SENTENCE_BREAK = ". ";

/** Derives a path-safe PDF name from the document title. */
export class OutputNamer {
  private readonly maxStemLength: number;

  constructor(settings: { maxStemLength: number }) {
    this.maxStemLength = settings.maxStemLength;
  }

  name(input: { title: string | undefined; scormId: number }): string {
    const title = input.title ?? "";
    const breakAt = title.indexOf(SENTENCE_BREAK);
    const head = breakAt === -1 ? title : title.slice(0, breakAt);
    const stem = this.slugify(head) || this.slugify(title) || `scorm-${input.scormId}`;
    return `${stem}.pdf`;
  }

  private slugify(text: string): string {
    return text
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, this.maxStemLength)
      .replace(/-+$/g, "");
  }
}
