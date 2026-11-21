import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HelpFormatter } from "../../src/cli/HelpFormatter.ts";
import { COMMAND_OPTIONS, GLOBAL_OPTIONS } from "../../src/cli/optionSpecs.ts";
import { en } from "../../src/i18n/en.ts";
import { builtInPlugins } from "../../src/composition/plugins.ts";

const text = new HelpFormatter({ programName: "tool", messages: en, plugins: builtInPlugins.commands }).format();
const lines = text.split("\n");

describe("HelpFormatter", () => {
  it("starts with usage and lists commands with the program name", () => {
    assert.equal(lines[0], "Usage: tool [command] [options]");
    assert.ok(lines.some((line) => /^ {2}tool courses {15}List enrolled courses$/.test(line)));
    assert.ok(lines.some((line) => line.includes("tool get <course>")));
  });

  it("shows option names, values, and localized descriptions", () => {
    const every = [...GLOBAL_OPTIONS, ...Object.values(COMMAND_OPTIONS).flat()];
    for (const spec of every) {
      const flag = `--${spec.name}${spec.valueKind ? ` <${en.help.values[spec.valueKind]}>` : ""}`;
      assert.ok(lines.some((line) => line.includes(flag) && line.includes(en.options[spec.name])), `Missing ${flag}`);
    }
    assert.ok(lines.some((line) => line.includes("-o, --out <file>")));
  });

  it("aligns option descriptions in one column", () => {
    const every = [...GLOBAL_OPTIONS, ...Object.values(COMMAND_OPTIONS).flat()];
    const columns = every.map((spec) => lines.find((line) => line.includes(en.options[spec.name]))!.indexOf(en.options[spec.name]));
    assert.equal(columns.length > 15 && new Set(columns).size, 1);
  });

  it("groups options under command headings", () => {
    for (const heading of [en.help.globalHeading(), en.help.scormHeading(), en.help.listHeading(), en.help.getHeading()]) {
      assert.ok(lines.includes(heading), `Missing heading ${heading}`);
    }
  });

  it("shows environment variables, exit codes, and examples", () => {
    assert.match(text, /MOODLE_COOKIE/);
    assert.match(text, /SCORM_TRACE/);
    assert.match(text, /3 {2}Invalid Moodle session/);
    assert.match(text, /\n {2}tool 10067\n/);
  });

  it("ends with a newline", () => assert.ok(text.endsWith("\n")));
});
