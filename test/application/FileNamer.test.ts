import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FileNamer } from "../../src/application/FileNamer.ts";

const namer = new FileNamer({ fallbackName: "archivo", maxNameBytes: 40 });

describe("FileNamer base names", () => {
  const cases: Array<[string, string, string]> = [
    ["preserves accents and punctuation", "Curs 5. Funcții", "Curs 5. Funcții"],
    ["replaces characters that are invalid in paths", 'a/b\\c:d*e?f"g<h>i|j', "a_b_c_d_e_f_g_h_i_j"],
    ["replaces control characters", "a\u0000b\u001fc", "a_b_c"],
    ["collapses whitespace and trims the name", "  uno \n  dos   ", "uno dos"],
    ["removes trailing dots and spaces", "nombre. . ", "nombre"],
    ["normalizes to NFC", "e\u0301", "é"],
    ["avoids reserved Windows names", "CON", "CON_"],
    ["avoids reserved Windows device names that end in a digit", "lpt3", "lpt3_"],
    ["keeps names that only start with a reserved name", "Console", "Console"],
    ["uses the fallback name when the result is empty", "...", "archivo"],
  ];
  for (const [name, input, expected] of cases) {
    it(name, () => assert.equal(namer.baseName(input), expected));
  }

  it("preserves a name at the byte limit and truncates a name over it", () => {
    assert.equal(namer.baseName("a".repeat(40)), "a".repeat(40));
    assert.equal(namer.baseName("a".repeat(41)), "a".repeat(40));
  });

  it("truncates UTF-8 without splitting a character", () => {
    const result = namer.baseName("ñ".repeat(100));
    assert.ok(Buffer.byteLength(result) <= 40);
    assert.ok(!result.includes("\uFFFD") && /^ñ+$/.test(result));
  });
});

describe("FileNamer extensions and final names", () => {
  it("uses the source file extension", () => {
    assert.equal(namer.fileName({ baseName: "Curs", sourceFileName: "x.PDF", contentType: undefined }), "Curs.PDF");
  });

  it("uses the content type when the source has no valid extension", () => {
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

  it("honors a forced extension", () => {
    assert.equal(namer.fileName({ baseName: "Curs", sourceFileName: "", contentType: "text/html", forcedExtension: ".pdf" }), "Curs.pdf");
  });

  it("keeps a matching extension already in the base name", () => {
    assert.equal(namer.fileName({ baseName: "Curs 1.pdf", sourceFileName: "a.pdf", contentType: undefined }), "Curs 1.pdf");
  });

  it("uses the section number as the folder name", () => {
    assert.deepEqual([namer.sectionDir(0), namer.sectionDir(3)], ["0", "3"]);
  });
});
