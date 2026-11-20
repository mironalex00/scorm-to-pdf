export interface DeckSlideInput {
  readonly src: string;
  readonly title?: string;
  readonly text?: string;
}

/** Matches the slide array and count declarations in a SCORM entry document. */
export function buildDeckHtml(options: { title?: string; slides: readonly DeckSlideInput[] }): string {
  const titleTag = options.title === undefined ? "" : `<title>${options.title}</title>`;
  const slides = options.slides.map((slide) => ({ links: [], ...slide }));
  return [
    "<!DOCTYPE html>",
    `<html lang="ro"><head><meta charset="utf-8">${titleTag}</head><body>`,
    "<script>",
    `const SLIDES = ${JSON.stringify(slides)};`,
    "const N = SLIDES.length;",
    "</script></body></html>",
  ].join("\n");
}
