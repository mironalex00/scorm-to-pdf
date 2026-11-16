import { describe, it } from "node:test";
import { es } from "../../src/i18n/es.ts";
import assert from "node:assert/strict";
import { PdfBuilder } from "../../src/pdf/PdfBuilder.ts";
import { JpegInspector } from "../../src/pdf/JpegInspector.ts";
import { ScormFormatError } from "../../src/domain/errors.ts";
import { makeJpeg } from "../support/jpegFixtures.ts";

const builder = new PdfBuilder({ messages: es, pageWidth: 200, pageHeight: 100, inspector: new JpegInspector({ messages: es }) });

function asText(pdf: Uint8Array): string {
  return Buffer.from(pdf).toString("latin1");
}

describe("PdfBuilder", () => {
  it("se niega a construir un PDF sin páginas", () => {
    assert.throws(() => builder.build([]), /No hay imágenes/);
  });

  it("genera cabecera, una página por imagen y pie %%EOF", () => {
    const pdf = asText(builder.build([makeJpeg({ width: 100, height: 100 }), makeJpeg({ width: 50, height: 50 })]));
    assert.ok(pdf.startsWith("%PDF-1.4\n"));
    assert.ok(pdf.endsWith("%%EOF\n"));
    assert.match(pdf, /\/Type \/Pages \/Kids \[3 0 R 6 0 R\] \/Count 2/);
    assert.equal(pdf.match(/\/Type \/Page \/Parent/g)?.length, 2);
    assert.equal(pdf.match(/\/MediaBox \[0 0 200 100\]/g)?.length, 2);
  });

  it("el xref apunta con exactitud al inicio de cada objeto", () => {
    const pdf = asText(builder.build([makeJpeg({ width: 100, height: 100 }), makeJpeg({ width: 80, height: 40 })]));
    const xrefStart = Number(/startxref\n(\d+)\n%%EOF/.exec(pdf)![1]);
    assert.equal(pdf.slice(xrefStart, xrefStart + 4), "xref");

    const lines = pdf.slice(xrefStart).split("\n");
    assert.equal(lines[1], "0 9");
    assert.equal(lines[2], "0000000000 65535 f ");
    for (let objectNumber = 1; objectNumber <= 8; objectNumber += 1) {
      const offset = Number(lines[2 + objectNumber]!.slice(0, 10));
      assert.equal(pdf.slice(offset, offset + `${objectNumber} 0 obj`.length), `${objectNumber} 0 obj`);
    }
  });

  it("escala sin deformar y centra: imagen cuadrada en página apaisada", () => {
    const pdf = asText(builder.build([makeJpeg({ width: 100, height: 100 })]));
    assert.match(pdf, /\n100 0 0 100 50 0 cm\n/);
  });

  it("escala sin deformar y centra: imagen muy ancha", () => {
    const pdf = asText(builder.build([makeJpeg({ width: 400, height: 100 })]));
    assert.match(pdf, /\n200 0 0 50 0 25 cm\n/);
  });

  it("incrusta los bytes del JPEG sin recomprimir y declara DCTDecode y su longitud real", () => {
    const jpeg = makeJpeg({ width: 100, height: 100, components: 1 });
    const pdf = builder.build([jpeg]);
    const text = asText(pdf);
    assert.match(text, /\/ColorSpace \/DeviceGray \/BitsPerComponent 8 \/Filter \/DCTDecode/);
    assert.match(text, new RegExp(`/Length ${jpeg.length} >>\\nstream\\n`));
    assert.notEqual(Buffer.from(pdf).indexOf(jpeg), -1);
  });

  it("la longitud declarada del flujo de contenido coincide con su tamaño", () => {
    const text = asText(builder.build([makeJpeg({ width: 100, height: 100 })]));
    const match = /<< \/Length (\d+) >>\nstream\n([\s\S]*?)endstream/.exec(text)!;
    assert.equal(Number(match[1]), match[2]!.length);
  });

  it("propaga el rechazo del inspector indicando qué diapositiva falla", () => {
    assert.throws(
      () => builder.build([makeJpeg({ width: 10, height: 10 }), makeJpeg({ width: 10, height: 10, components: 4 })]),
      (error: unknown) => error instanceof ScormFormatError && /diapositiva 2/.test(error.message),
    );
  });
});
