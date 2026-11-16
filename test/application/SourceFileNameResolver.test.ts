import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SourceFileNameResolver } from "../../src/application/SourceFileNameResolver.ts";

const resolver = new SourceFileNameResolver();
const url = (path: string) => new URL(`https://h.example/pluginfile.php/55/mod_resource/content/1/${path}`);

describe("SourceFileNameResolver", () => {
  const cases: Array<[string, string, string | undefined, string]> = [
    ["filename entre comillas", "x.pdf", 'attachment; filename="Curs 5.pdf"', "Curs 5.pdf"],
    ["filename sin comillas", "x.pdf", "inline; filename=plain.pdf", "plain.pdf"],
    ["filename* con UTF-8 tiene prioridad", "x.pdf", `attachment; filename="a.pdf"; filename*=UTF-8''Exerci%C8%9Bii.pdf`, "Exerciții.pdf"],
    ["se queda con el nombre base de una ruta maliciosa", "x.pdf", 'attachment; filename="../../etc/x.pdf"', "x.pdf"],
    ["sin cabecera usa el último segmento decodificado", "Curs%201.pdf", undefined, "Curs 1.pdf"],
    ["cabecera sin filename usa la URL", "a.pdf", "inline", "a.pdf"],
    ["ignora la query de la URL", "a.pdf?forcedownload=1", undefined, "a.pdf"],
    ["porcentaje mal formado se deja tal cual", "a%E0%A4%A.pdf", undefined, "a%E0%A4%A.pdf"],
    ["filename* mal formado cae al filename normal", "x.pdf", `attachment; filename*=UTF-8''%E0%A4%A; filename="ok.pdf"`, "ok.pdf"],
    ["sin nombre posible devuelve cadena vacía", "", undefined, ""],
  ];
  for (const [name, path, header, expected] of cases) {
    it(name, () => assert.equal(resolver.resolve({ url: url(path), contentDisposition: header }), expected));
  }
});
