const SENTENCE_BREAK = ". ";

/**
 * Deduce el nombre del PDF a partir del título del documento. El título viene del
 * servidor, así que solo sobreviven letras, números y guiones: nunca separadores
 * de ruta ni caracteres de control.
 */
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
