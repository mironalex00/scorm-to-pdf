const VOID_TAGS: ReadonlySet<string> = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr",
]);
const RAW_TEXT_TAGS: ReadonlySet<string> = new Set(["script", "style"]);
const NAMED_ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

const CLOSE_TAG = /<\/([a-zA-Z][\w:-]*)\s*>/y;
const OPEN_TAG = /<([a-zA-Z][\w:-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/y;
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] !== "#") return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
    const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

export class HtmlElement {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: Array<HtmlElement | string> = [];

  constructor(tag: string, attrs: Readonly<Record<string, string>>) {
    this.tag = tag;
    this.attrs = attrs;
  }

  attr(name: string): string | undefined {
    return this.attrs[name];
  }

  hasClass(name: string): boolean {
    return (this.attrs.class ?? "").split(/\s+/).includes(name);
  }

  /** Texto contenido, con los espacios colapsados. */
  text(): string {
    return this.rawText().replace(/\s+/g, " ").trim();
  }

  /** Descendientes que cumplen el predicado, en orden de documento (sin incluir el propio elemento). */
  findAll(predicate: (element: HtmlElement) => boolean): HtmlElement[] {
    const found: HtmlElement[] = [];
    this.walk(predicate, found);
    return found;
  }

  find(predicate: (element: HtmlElement) => boolean): HtmlElement | undefined {
    return this.findAll(predicate)[0];
  }

  private rawText(): string {
    return this.children.map((child) => (typeof child === "string" ? child : child.rawText())).join("");
  }

  private walk(predicate: (element: HtmlElement) => boolean, into: HtmlElement[]): void {
    for (const child of this.children) {
      if (typeof child === "string") continue;
      if (predicate(child)) into.push(child);
      child.walk(predicate, into);
    }
  }
}

/**
 * Lector de HTML tolerante y sin dependencias: suficiente para extraer datos de páginas de Moodle,
 * no un navegador. No aplica reglas de cierre implícito; recupera los cierres desajustados.
 */
export class HtmlParser {
  parse(html: string): HtmlElement {
    const root = new HtmlElement("#root", {});
    const stack: HtmlElement[] = [root];
    const lower = html.toLowerCase();
    let index = 0;

    const top = (): HtmlElement => stack[stack.length - 1]!;
    const pushText = (raw: string): void => {
      const text = decodeEntities(raw);
      if (text !== "") top().children.push(text);
    };

    while (index < html.length) {
      const lt = html.indexOf("<", index);
      if (lt === -1) {
        pushText(html.slice(index));
        break;
      }
      if (lt > index) pushText(html.slice(index, lt));

      if (html.startsWith("<!--", lt)) {
        const end = html.indexOf("-->", lt + 4);
        index = end === -1 ? html.length : end + 3;
        continue;
      }
      if (html.startsWith("<!", lt) || html.startsWith("<?", lt)) {
        const end = html.indexOf(">", lt);
        index = end === -1 ? html.length : end + 1;
        continue;
      }

      CLOSE_TAG.lastIndex = lt;
      const close = CLOSE_TAG.exec(html);
      if (close) {
        const tag = close[1]!.toLowerCase();
        const position = stack.map((element) => element.tag).lastIndexOf(tag);
        if (position > 0) stack.length = position;
        index = CLOSE_TAG.lastIndex;
        continue;
      }

      OPEN_TAG.lastIndex = lt;
      const open = OPEN_TAG.exec(html);
      if (!open) {
        pushText("<");
        index = lt + 1;
        continue;
      }
      const tag = open[1]!.toLowerCase();
      const element = new HtmlElement(tag, this.parseAttributes(open[2]!));
      top().children.push(element);
      index = OPEN_TAG.lastIndex;

      if (RAW_TEXT_TAGS.has(tag) && open[3] !== "/") {
        const end = lower.indexOf(`</${tag}`, index);
        index = end === -1 ? html.length : end;
        continue;
      }
      if (!VOID_TAGS.has(tag) && open[3] !== "/") stack.push(element);
    }
    return root;
  }

  private parseAttributes(source: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (const match of source.matchAll(ATTRIBUTE)) {
      const value = match[2] ?? match[3] ?? match[4] ?? "";
      attrs[match[1]!.toLowerCase()] = decodeEntities(value);
    }
    return attrs;
  }
}
