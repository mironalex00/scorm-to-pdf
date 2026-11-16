import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FileNamer } from "../../src/application/FileNamer.ts";

const namer = new FileNamer({ fallbackName: "archivo", maxNameBytes: 40 });

describe("FileNamer · nombre base", () => {
  const cases: Array<[string, string, string]> = [
    ["conserva un nombre legible con acentos y puntuación", "Curs 5. Funcții", "Curs 5. Funcții"],
    ["sustituye los caracteres no permitidos", 'a/b\\c:d*e?f"g<h>i|j', "a_b_c_d_e_f_g_h_i_j"],
    ["sustituye los caracteres de control", "a\u0000b\u001fc", "a_b_c"],
    ["colapsa espacios y recorta", "  uno \n  dos   ", "uno dos"],
    ["quita puntos y espacios finales", "nombre. . ", "nombre"],
    ["normaliza a NFC", "e\u0301", "é"],
    ["evita los nombres reservados de Windows", "CON", "CON_"],
    ["evita los reservados con numeración", "lpt3", "lpt3_"],
    ["un nombre que solo contiene el prefijo reservado no se altera", "Console", "Console"],
    ["usa el nombre de reserva si queda vacío", "...", "archivo"],
  ];
  for (const [name, input, expected] of cases) {
    it(name, () => assert.equal(namer.baseName(input), expected));
  }

  it("conserva íntegro un nombre que mide exactamente el máximo de bytes y recorta uno que lo supera por uno", () => {
    assert.equal(namer.baseName("a".repeat(40)), "a".repeat(40));
    assert.equal(namer.baseName("a".repeat(41)), "a".repeat(40));
  });

  it("limita la longitud en bytes UTF-8 sin cortar un carácter por la mitad", () => {
    const result = namer.baseName("ñ".repeat(100));
    assert.ok(Buffer.byteLength(result) <= 40);
    assert.ok(!result.includes("\uFFFD") && /^ñ+$/.test(result));
  });
});

describe("FileNamer · extensión y nombre final", () => {
  it("toma la extensión del archivo de origen", () => {
    assert.equal(namer.fileName({ baseName: "Curs", sourceFileName: "x.PDF", contentType: undefined }), "Curs.PDF");
  });

  it("recurre al tipo de contenido cuando el origen no tiene una extensión válida", () => {
    const types: Array<[string, string]> = [
      ["application/pdf", ".pdf"],
      ["application/pdf; charset=binary", ".pdf"],
      ["application/vnd.openxmlformats-officedocument.presentationml.presentation", ".pptx"],
      ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"],
      ["application/msword", ".doc"],
      ["application/zip", ".zip"],
      ["application/x-desconocido", ""],
    ];
    for (const [contentType, ext] of types) {
      assert.equal(namer.fileName({ baseName: "A", sourceFileName: "sin-extension", contentType }), `A${ext}`);
    }
    assert.equal(namer.fileName({ baseName: "A", sourceFileName: "x.extensionlarguisima", contentType: "application/pdf" }), "A.pdf");
    assert.equal(namer.fileName({ baseName: "A", sourceFileName: "x.a-b", contentType: undefined }), "A");
  });

  it("una extensión forzada tiene prioridad", () => {
    assert.equal(namer.fileName({ baseName: "Curs", sourceFileName: "", contentType: "text/html", forcedExtension: ".pdf" }), "Curs.pdf");
  });

  it("no duplica la extensión si el nombre base ya la trae", () => {
    assert.equal(namer.fileName({ baseName: "Curs 1.pdf", sourceFileName: "a.pdf", contentType: undefined }), "Curs 1.pdf");
  });

  it("la carpeta de una sección es su número tal cual", () => {
    assert.deepEqual([namer.sectionDir(0), namer.sectionDir(3)], ["0", "3"]);
  });
});
