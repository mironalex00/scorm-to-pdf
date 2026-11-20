import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HtmlParser, decodeEntities } from "../../src/html/HtmlParser.ts";

const parse = (html: string) => new HtmlParser().parse(html);

describe("HtmlParser structure", () => {
  it("parses lowercase tags and attributes with different quote styles", () => {
    const root = parse(`<DIV CLASS="a b" data-x='1' id=main hidden><span>hola</span></DIV>`);
    const div = root.find((e) => e.tag === "div")!;
    assert.deepEqual(div.attrs, { class: "a b", "data-x": "1", id: "main", hidden: "" });
    assert.equal(div.find((e) => e.tag === "span")!.text(), "hola");
  });

  it("keeps siblings outside void elements", () => {
    const root = parse(`<p>uno<br>dos<img src="x.png"><input name=n>tres</p><p>cuatro</p>`);
    const paragraphs = root.findAll((e) => e.tag === "p");
    assert.deepEqual(paragraphs.map((p) => p.text()), ["unodostres", "cuatro"]);
    assert.equal(root.findAll((e) => e.tag === "br").length, 1);
  });

  it("handles self-closing tags", () => {
    const root = parse(`<div><svg/><span>x</span></div>`);
    assert.equal(root.find((e) => e.tag === "svg")!.children.length, 0);
    assert.equal(root.find((e) => e.tag === "div")!.findAll(() => true).length, 2);
  });

  it("ignores comments, the doctype, and script and style contents", () => {
    const root = parse(`<!DOCTYPE html><!-- <b>no</b> --><script>if (a<b) { x = "<div>" }</script><style>p>a{}</style><i>sí</i>`);
    assert.deepEqual(root.findAll(() => true).map((e) => e.tag), ["script", "style", "i"]);
    assert.equal(root.text(), "sí");
  });

  it("recovers from stray and mismatched closing tags and unclosed elements", () => {
    const root = parse(`</div><p><b>x</p>y<em>z`);
    assert.equal(root.find((e) => e.tag === "p")!.text(), "x");
    assert.equal(root.text(), "xyz");
    assert.equal(root.find((e) => e.tag === "em")!.text(), "z");
  });

  it("treats a less-than sign outside a tag as text", () => {
    assert.equal(parse(`<p>a < b y c <3</p>`).text(), "a < b y c <3");
  });

  it("consumes the rest of the document after an unclosed comment or declaration", () => {
    assert.equal(parse(`<p>a</p><!-- sin cerrar <b>`).text(), "a");
    assert.equal(parse(`<p>a</p><!doctype sin cerrar`).text(), "a");
  });

  it("consumes the rest of the document after an unclosed script", () => {
    assert.equal(parse(`<i>a</i><script>var x = 1;`).text(), "a");
  });

  it("keeps text after an uppercase script close following Turkish text", () => {
    const root = parse("<h2>\u0130stanbul<script>const label = '</scripture>';</SCRIPT> - Week 1</h2>");
    assert.equal(root.find((element) => element.tag === "h2")?.text(), "\u0130stanbul - Week 1");
  });
});

describe("HtmlParser queries", () => {
  const root = parse(`<ul class="  lista  grande "><li class="x" data-n="1">A</li><li class="x y" data-n="2">B <b>negrita</b></li></ul>`);

  it("handles multiple class names separated by whitespace", () => {
    const ul = root.find((e) => e.tag === "ul")!;
    assert.deepEqual([ul.hasClass("lista"), ul.hasClass("grande"), ul.hasClass("otra")], [true, true, false]);
    assert.equal(parse("<p>x</p>").find((e) => e.tag === "p")!.hasClass("a"), false);
  });

  it("returns the attribute value or undefined", () => {
    const li = root.find((e) => e.tag === "li")!;
    assert.deepEqual([li.attr("data-n"), li.attr("missing")], ["1", undefined]);
  });

  it("finds descendants in document order and excludes the starting element", () => {
    const ul = root.find((e) => e.tag === "ul")!;
    assert.deepEqual(ul.findAll(() => true).map((e) => e.tag), ["li", "li", "b"]);
    assert.equal(ul.find((e) => e.tag === "p"), undefined);
  });

  it("joins child text and collapses whitespace", () => {
    assert.equal(parse(`<p>  uno \n   dos <b> tres </b>  </p>`).text(), "uno dos tres");
  });

  it("visits nested elements in order and stops searching at the first match", () => {
    const depth = 2_000;
    const root = parse("<div>".repeat(depth) + "<b>First</b><b>Second</b>" + "</div>".repeat(depth));
    assert.equal(root.text(), "FirstSecond");
    assert.deepEqual(root.findAll((element) => element.tag === "b").map((element) => element.text()), ["First", "Second"]);

    let visited = 0;
    const found = root.find((element) => {
      visited += 1;
      return element.tag === "b";
    });
    assert.equal(found?.text(), "First");
    assert.equal(visited, depth + 1);
  });
});

describe("decodeEntities", () => {
  it("decodes named entities and decimal and hexadecimal references", () => {
    assert.equal(decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &apos;f&apos;"), `a & b <c> "d" 'e' 'f'`);
    assert.equal(decodeEntities("S&#259;pt&#x103;m&acirc;na"), "Săptăm&acirc;na");
    assert.equal(decodeEntities("a&nbsp;b"), "a b");
  });

  it("preserves unknown and malformed entities", () => {
    assert.equal(decodeEntities("&desconocida; & &#xZZ; &#99999999999;"), "&desconocida; & &#xZZ; &#99999999999;");
  });

  it("decodes entities in attributes and text", () => {
    const a = parse(`<a href="x?a=1&amp;b=2" title="&quot;t&quot;">Exerci&#539;ii &amp; teme</a>`).find((e) => e.tag === "a")!;
    assert.deepEqual([a.attr("href"), a.attr("title"), a.text()], ["x?a=1&b=2", '"t"', "Exerciții & teme"]);
  });
});
