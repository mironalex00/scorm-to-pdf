import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CliApplication } from "../../src/CliApplication.ts";
import type { CommandPlugin, PluginCommandContext } from "../../src/cli/CommandPlugin.ts";
import { i18nPlugin } from "../../src/plugins/i18n/index.ts";
import { PluginRegistry } from "../../src/plugins/PluginRegistry.ts";
import { CapturedStream } from "../support/streams.ts";

function examplePlugin(contexts: PluginCommandContext[] = []): CommandPlugin {
  return {
    id: "report-preview",
    command: "preview",
    options: [{ name: "preview-json", kind: "boolean", describe: ({ options }) => options.json }],
    environmentKeys: ["PREVIEW_FORMAT"],
    describe: ({ help }, program) => ({
      listing: `  ${program} preview`,
      intro: help.intro({ program }),
      heading: help.listHeading(),
      footer: "",
    }),
    parse: (options, positionals) => {
      assert.ok(options.flags.has("preview-json"));
      assert.deepEqual(positionals, ["current"]);
      return {
        action: "show",
        async run(context) {
          contexts.push(context);
          context.stdout.write(JSON.stringify({ locale: context.messages.locale }));
          return 7;
        },
      };
    },
  };
}

describe("PluginRegistry", () => {
  it("rejects duplicate plugin IDs and built-in or registered command names", () => {
    const plugin = examplePlugin();
    assert.throws(() => new PluginRegistry(i18nPlugin, [{ ...plugin, id: i18nPlugin.id }]), /Duplicate plugin ID: i18n/);
    assert.throws(() => new PluginRegistry(i18nPlugin, [{ ...plugin, command: "tui" }]), /Duplicate command: tui/);
    assert.throws(() => new PluginRegistry(i18nPlugin, [plugin, { ...plugin, id: "other" }]), /Duplicate command: preview/);
  });

  it("adds a command with localized help and passes only its declared environment", async () => {
    const stdout = new CapturedStream();
    const stderr = new CapturedStream();
    const contexts: PluginCommandContext[] = [];
    const app = new CliApplication({
      stdout, stderr,
      env: { LANG: "es_MX.UTF-8", PREVIEW_FORMAT: "json", MOODLE_COOKIE: "test-private", MOODLE_BASE_URL: "invalid" },
      plugins: new PluginRegistry(i18nPlugin, [examplePlugin(contexts)]),
    });

    assert.equal(await app.run(["--help"]), 0);
    assert.match(stdout.output, /^Uso: scorm-to-pdf /);
    assert.match(stdout.output, /scorm-to-pdf preview/);
    assert.match(stdout.output, /--preview-json {2,}.*JSON/);
    assert.equal(await app.run(["--preview-json", "preview", "current", "-q", "--lang", "ro"]), 7);
    assert.match(stdout.output, /"locale":"ro"/);
    assert.equal(stderr.output, "");
    assert.equal(contexts.length, 1);
    assert.deepEqual(contexts[0]!.env, { PREVIEW_FORMAT: "json" });
    assert.equal(contexts[0]!.quiet, true);
    assert.equal(contexts[0]!.signal.aborted, false);
  });
});
