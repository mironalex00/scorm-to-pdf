import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HtmlParser, decodeEntities } from "../../src/html/HtmlParser.ts";

const parse = (html: string) => new HtmlParser().parse(html);

describe("HtmlParser · estructura", () => {
  it("construye el árbol con etiquetas y atributos en minúsculas y varios estilos de comillas", () => {
    const root = parse(`<DIV CLASS="a b" data-x='1' id=main hidden><span>hola</span></DIV>`);
    const div = root.find((e) => e.tag === "div")!;
    assert.deepEqual(div.attrs, { class: "a b", "data-x": "1", id: "main", hidden: "" });
    assert.equal(div.find((e) => e.tag === "span")!.text(), "hola");
  });

  it("los elementos vacíos no se tragan a sus hermanos", () => {
    const root = parse(`<p>uno<br>dos<img src="x.png"><input name=n>tres</p><p>cuatro</p>`);
    const paragraphs = root.findAll((e) => e.tag === "p");
    assert.deepEqual(paragraphs.map((p) => p.text()), ["unodostres", "cuatro"]);
    assert.equal(root.findAll((e) => e.tag === "br").length, 1);
  });

  it("respeta las etiquetas autocerradas con />", () => {
    const root = parse(`<div><svg/><span>x</span></div>`);
    assert.equal(root.find((e) => e.tag === "svg")!.children.length, 0);
    assert.equal(root.find((e) => e.tag === "div")!.findAll(() => true).length, 2);
  });

  it("ignora comentarios, doctype y el contenido de script y style", () => {
    const root = parse(`<!DOCTYPE html><!-- <b>no</b> --><script>if (a<b) { x = "<div>" }</script><style>p>a{}</style><i>sí</i>`);
    assert.deepEqual(root.findAll(() => true).map((e) => e.tag), ["script", "style", "i"]);
    assert.equal(root.text(), "sí");
  });

  it("recupera etiquetas de cierre sueltas, desajustadas y sin cerrar", () => {
    const root = parse(`</div><p><b>x</p>y<em>z`);
    assert.equal(root.find((e) => e.tag === "p")!.text(), "x");
    assert.equal(root.text(), "xyz");
    assert.equal(root.find((e) => e.tag === "em")!.text(), "z");
  });

  it("un < que no inicia una etiqueta es texto", () => {
    assert.equal(parse(`<p>a < b y c <3</p>`).text(), "a < b y c <3");
  });

  it("un comentario o declaración sin cerrar consume hasta el final sin colgarse", () => {
    assert.equal(parse(`<p>a</p><!-- sin cerrar <b>`).text(), "a");
    assert.equal(parse(`<p>a</p><!doctype sin cerrar`).text(), "a");
  });

  it("un script sin cierre consume el resto del documento", () => {
    assert.equal(parse(`<i>a</i><script>var x = 1;`).text(), "a");
  });
});

describe("HtmlParser · consultas", () => {
  const root = parse(`<ul class="  lista  grande "><li class="x" data-n="1">A</li><li class="x y" data-n="2">B <b>negrita</b></li></ul>`);

  it("hasClass tolera espacios y varias clases", () => {
    const ul = root.find((e) => e.tag === "ul")!;
    assert.deepEqual([ul.hasClass("lista"), ul.hasClass("grande"), ul.hasClass("otra")], [true, true, false]);
    assert.equal(parse("<p>x</p>").find((e) => e.tag === "p")!.hasClass("a"), false);
  });

  it("attr devuelve el valor o undefined", () => {
    const li = root.find((e) => e.tag === "li")!;
    assert.deepEqual([li.attr("data-n"), li.attr("nada")], ["1", undefined]);
  });

  it("findAll devuelve los descendientes en orden de documento sin incluir el propio elemento", () => {
    const ul = root.find((e) => e.tag === "ul")!;
    assert.deepEqual(ul.findAll(() => true).map((e) => e.tag), ["li", "li", "b"]);
    assert.equal(ul.find((e) => e.tag === "p"), undefined);
  });

  it("text normaliza espacios y une los hijos", () => {
    assert.equal(parse(`<p>  uno \n   dos <b> tres </b>  </p>`).text(), "uno dos tres");
  });
});

describe("decodeEntities", () => {
  it("decodifica entidades nombradas y numéricas (decimales y hexadecimales)", () => {
    assert.equal(decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &apos;f&apos;"), `a & b <c> "d" 'e' 'f'`);
    assert.equal(decodeEntities("S&#259;pt&#x103;m&acirc;na"), "Săptăm&acirc;na");
    assert.equal(decodeEntities("a&nbsp;b"), "a b");
  });

  it("deja intactas las entidades desconocidas o malformadas", () => {
    assert.equal(decodeEntities("&desconocida; & &#xZZ; &#99999999999;"), "&desconocida; & &#xZZ; &#99999999999;");
  });

  it("se aplica a los atributos y al texto del árbol", () => {
    const a = parse(`<a href="x?a=1&amp;b=2" title="&quot;t&quot;">Exerci&#539;ii &amp; teme</a>`).find((e) => e.tag === "a")!;
    assert.deepEqual([a.attr("href"), a.attr("title"), a.text()], ["x?a=1&b=2", '"t"', "Exerciții & teme"]);
  });
});
