const VOID_TAGS: ReadonlySet<string> = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr",
]);
const RAW_TEXT_TAGS: ReadonlySet<string> = new Set(["script", "style"]);
const NAMED_ENTITIES = new Map([["amp", "&"], ["lt", "<"], ["gt", ">"], ["quot", '"'], ["apos", "'"], ["nbsp", " "]]);

const CLOSE_TAG = /<\/([a-zA-Z][\w:-]*)\s*>/y;
const OPEN_TAG = /<([a-zA-Z][\w:-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/y;
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] !== "#") return NAMED_ENTITIES.get(body.toLowerCase()) ?? whole;
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
    return Object.hasOwn(this.attrs, name) ? this.attrs[name] : undefined;
  }

  hasClass(name: string): boolean {
    return (this.attrs.class ?? "").split(/\s+/).includes(name);
  }

  /** Returns descendant text with whitespace collapsed. */
  text(): string {
    const text: string[] = [];
    for (const node of this.descendants()) {
      if (typeof node === "string") text.push(node);
    }
    return text.join("").replace(/\s+/g, " ").trim();
  }

  /** Returns matching descendants in document order. */
  findAll(predicate: (element: HtmlElement) => boolean): HtmlElement[] {
    const found: HtmlElement[] = [];
    for (const node of this.descendants()) {
      if (typeof node !== "string" && predicate(node)) found.push(node);
    }
    return found;
  }

  find(predicate: (element: HtmlElement) => boolean): HtmlElement | undefined {
    for (const node of this.descendants()) {
      if (typeof node !== "string" && predicate(node)) return node;
    }
    return undefined;
  }

  private *descendants(): Generator<HtmlElement | string> {
    const path = [this.children[Symbol.iterator]()];
    while (path.length > 0) {
      const next = path.at(-1)!.next();
      if (next.done) {
        path.pop();
        continue;
      }
      const node = next.value;
      yield node;
      if (typeof node !== "string" && node.children.length > 0) path.push(node.children[Symbol.iterator]());
    }
  }
}

/** Reads Moodle markup with explicit tag boundaries and recovers from mismatched closing tags. */
export class HtmlParser {
  parse(html: string): HtmlElement {
    const root = new HtmlElement("#root", {});
    const stack: HtmlElement[] = [root];
    const openPositions = new Map<string, number[]>();
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
        const position = openPositions.get(tag)?.at(-1);
        if (position !== undefined) {
          while (stack.length > position) openPositions.get(stack.pop()!.tag)!.pop();
        }
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
        const endTag = new RegExp(`</${tag}\\s*>`, "gi");
        endTag.lastIndex = index;
        index = endTag.exec(html) ? endTag.lastIndex : html.length;
        continue;
      }
      if (!VOID_TAGS.has(tag) && open[3] !== "/") {
        const positions = openPositions.get(tag);
        if (positions) positions.push(stack.length);
        else openPositions.set(tag, [stack.length]);
        stack.push(element);
      }
    }
    return root;
  }

  private parseAttributes(source: string): Record<string, string> {
    const attrs: Record<string, string> = Object.create(null);
    for (const match of source.matchAll(ATTRIBUTE)) {
      const value = match[2] ?? match[3] ?? match[4] ?? "";
      attrs[match[1]!.toLowerCase()] = decodeEntities(value);
    }
    return { ...attrs };
  }
}
