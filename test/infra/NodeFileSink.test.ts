import { afterEach, beforeEach, describe, it } from "node:test";
import { es } from "../../src/i18n/es.ts";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSink } from "../../src/infra/NodeFileSink.ts";
import { OutputError } from "../../src/domain/errors.ts";

let dir: string;
const sink = new NodeFileSink({ messages: es });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "scorm-sink-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("NodeFileSink", () => {
  it("crea las carpetas que falten, escribe el contenido y devuelve la ruta absoluta", async () => {
    const target = join(dir, "a", "b", "salida.pdf");
    const written = await sink.write(target, Uint8Array.of(1, 2, 3));
    assert.equal(written, target);
    assert.deepEqual([...(await readFile(target))], [1, 2, 3]);
  });

  it("exists distingue entre un archivo presente y uno ausente", async () => {
    await sink.write(join(dir, "hay.pdf"), Uint8Array.of(1));
    assert.deepEqual([await sink.exists(join(dir, "hay.pdf")), await sink.exists(join(dir, "no-hay.pdf"))], [true, false]);
  });

  it("resuelve rutas relativas contra el directorio actual", async () => {
    const previous = process.cwd();
    process.chdir(dir);
    try {
      const written = await sink.write("rel.pdf", Uint8Array.of(9));
      assert.ok(written.endsWith("rel.pdf"));
      assert.ok(written.startsWith("/") || /^[A-Za-z]:/.test(written));
    } finally {
      process.chdir(previous);
    }
  });

  it("reemplaza un archivo existente sin dejar temporales", async () => {
    const target = join(dir, "x.pdf");
    await writeFile(target, "viejo");
    await sink.write(target, Uint8Array.of(7));
    assert.deepEqual([...(await readFile(target))], [7]);
    assert.deepEqual(await readdir(dir), ["x.pdf"]);
  });

  it("falla con OutputError si la carpeta no se puede crear", async () => {
    await writeFile(join(dir, "archivo"), "x");
    await assert.rejects(sink.write(join(dir, "archivo", "hijo.pdf"), Uint8Array.of(1)), OutputError);
  });

  it("falla con OutputError y limpia el temporal si el destino es una carpeta", async () => {
    await mkdir(join(dir, "salida.pdf"));
    await assert.rejects(sink.write(join(dir, "salida.pdf"), Uint8Array.of(1)), OutputError);
    assert.deepEqual(await readdir(dir), ["salida.pdf"]);
  });
});
