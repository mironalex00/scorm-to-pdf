import { describe, it } from "node:test";
import { es } from "../../src/i18n/es.ts";
import assert from "node:assert/strict";
import { JpegInspector } from "../../src/pdf/JpegInspector.ts";
import { ScormFormatError } from "../../src/domain/errors.ts";
import { makeJpeg } from "../support/jpegFixtures.ts";

const inspector = new JpegInspector({ messages: es });

function assertRejected(bytes: Uint8Array, pattern: RegExp): void {
  assert.throws(
    () => inspector.inspect(bytes, 4),
    (error: unknown) => error instanceof ScormFormatError && pattern.test(error.message),
  );
}

describe("JpegInspector", () => {
  it("lee dimensiones y espacio de color RGB de un JPEG baseline", () => {
    assert.deepEqual(inspector.inspect(makeJpeg({ width: 1920, height: 1080 }), 1), {
      width: 1920,
      height: 1080,
      colorSpace: "/DeviceRGB",
    });
  });

  it("reconoce JPEG en escala de grises", () => {
    assert.equal(inspector.inspect(makeJpeg({ width: 10, height: 20, components: 1 }), 1).colorSpace, "/DeviceGray");
  });

  it("acepta JPEG progresivo (SOF2)", () => {
    const info = inspector.inspect(makeJpeg({ width: 640, height: 360, progressive: true }), 1);
    assert.deepEqual([info.width, info.height], [640, 360]);
  });

  it("salta bytes de relleno 0xFF y marcadores sin longitud antes del frame", () => {
    const bytes = makeJpeg({ width: 30, height: 40, beforeFrame: [0xff, 0xff, 0xff, 0xd0, 0xff, 0x01, 0xff, 0xd8] });
    const info = inspector.inspect(bytes, 1);
    assert.deepEqual([info.width, info.height], [30, 40]);
  });

  it("salta bytes sueltos entre segmentos hasta el siguiente marcador", () => {
    const info = inspector.inspect(makeJpeg({ width: 11, height: 22, beforeFrame: [0x00, 0x11, 0x22] }), 1);
    assert.deepEqual([info.width, info.height], [11, 22]);
  });

  it("rechaza JPEG con 4 componentes (CMYK) indicando la diapositiva", () => {
    assertRejected(makeJpeg({ width: 5, height: 5, components: 4 }), /diapositiva 4.*4 componentes/);
  });

  it("rechaza dimensiones cero", () => {
    assertRejected(makeJpeg({ width: 0, height: 5 }), /Dimensiones JPEG inválidas.*diapositiva 4/);
    assertRejected(makeJpeg({ width: 5, height: 0 }), /Dimensiones JPEG inválidas/);
  });

  it("rechaza datos que no empiezan con SOI", () => {
    assertRejected(Uint8Array.from([0x3c, 0x68, 0x74, 0x6d, 0x6c]), /SOI/);
  });

  const unreadable: Array<[string, number[]]> = [
    ["solo SOI", [0xff, 0xd8]],
    ["SOI seguido de relleno sin marcador", [0xff, 0xd8, 0xff]],
    ["longitud de segmento truncada", [0xff, 0xd8, 0xff, 0xe0, 0x00]],
    ["longitud de segmento menor que 2", [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0x00]],
    ["segmento que excede el archivo", [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x20, 0x00]],
    ["SOF demasiado corto", [0xff, 0xd8, 0xff, 0xc0, 0x00, 0x05, 0x08, 0x00, 0x01]],
    ["SOS antes del SOF", [0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]],
  ];
  for (const [name, bytes] of unreadable) {
    it(`rechaza JPEG ilegible: ${name}`, () => {
      assertRejected(Uint8Array.from(bytes), /No se pudieron leer las dimensiones.*diapositiva 4/);
    });
  }
});
