import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HelpFormatter } from "../../src/cli/HelpFormatter.ts";
import { COMMAND_OPTIONS, GLOBAL_OPTIONS } from "../../src/cli/optionSpecs.ts";
import { es } from "../../src/i18n/es.ts";

const text = new HelpFormatter({ programName: "tool", messages: es }).format();
const lines = text.split("\n");

describe("HelpFormatter", () => {
  it("empieza con la línea de uso y lista las órdenes con el nombre del programa", () => {
    assert.equal(lines[0], "Uso: tool [orden] [opciones]");
    assert.ok(lines.some((line) => /^ {2}tool courses {15}Lista tus cursos$/.test(line)));
    assert.ok(lines.some((line) => line.includes("tool get <curso>")));
  });

  it("lista cada opción con su forma corta, larga, valor y la descripción del catálogo", () => {
    const every = [...GLOBAL_OPTIONS, ...Object.values(COMMAND_OPTIONS).flat()];
    for (const spec of every) {
      const flag = `--${spec.name}${spec.valueKind ? ` <${es.help.values[spec.valueKind]}>` : ""}`;
      assert.ok(lines.some((line) => line.includes(flag) && line.includes(es.options[spec.name])), `falta ${flag}`);
    }
    assert.ok(lines.some((line) => line.includes("-o, --out <archivo>")));
  });

  it("alinea todas las descripciones de opciones en la misma columna", () => {
    const every = [...GLOBAL_OPTIONS, ...Object.values(COMMAND_OPTIONS).flat()];
    const columns = every.map((spec) => lines.find((line) => line.includes(es.options[spec.name]))!.indexOf(es.options[spec.name]));
    assert.equal(columns.length > 15 && new Set(columns).size, 1);
  });

  it("agrupa las opciones por orden con sus encabezados", () => {
    for (const heading of [es.help.globalHeading(), es.help.scormHeading(), es.help.listHeading(), es.help.getHeading()]) {
      assert.ok(lines.includes(heading), `falta «${heading}»`);
    }
  });

  it("documenta el entorno, los códigos de salida y los ejemplos", () => {
    assert.match(text, /MOODLE_COOKIE/);
    assert.match(text, /SCORM_TRACE/);
    assert.match(text, /3 {2}Sesión de Moodle no válida/);
    assert.match(text, /\n {2}tool 10067\n/);
  });

  it("termina con un salto de línea", () => assert.ok(text.endsWith("\n")));
});
