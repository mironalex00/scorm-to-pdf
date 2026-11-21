import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { BatchReport } from "../../src/application/BatchDownloader.ts";
import { CatalogService } from "../../src/application/CatalogService.ts";
import { FileNamer } from "../../src/application/FileNamer.ts";
import type { ItemOutcome } from "../../src/application/ItemDownloader.ts";
import { ReportPrinter } from "../../src/application/ReportPrinter.ts";
import { AuthenticationError, DownloadError } from "../../src/domain/errors.ts";
import type { CourseContents, CourseItem } from "../../src/domain/catalog.ts";
import { asciiAnimations } from "../../src/plugins/ascii-fire/generatedAnimations.ts";
import { fitTerminalFrame } from "../../src/tui/fitTerminalFrame.ts";
import { en } from "../../src/i18n/en.ts";
import { CompressedStore } from "../../src/store/CompressedStore.ts";
import { NullTracer } from "../../src/tracing/NullTracer.ts";
import { Redactor } from "../../src/tracing/Redactor.ts";
import { CookiePrompt } from "../../src/tui/CookiePrompt.ts";
import { FrameLayout } from "../../src/tui/FrameLayout.ts";
import { TuiApplication } from "../../src/tui/TuiApplication.ts";
import { TuiLogger } from "../../src/tui/TuiLogger.ts";
import { FakePlatform } from "../support/FakePlatform.ts";
import { MemoryLogger } from "../support/fakes.ts";
import { ScriptedTerminal, chars, key } from "../support/ScriptedTerminal.ts";
import type { KeyPress } from "../../src/tui/Terminal.ts";
import { CapturedStream } from "../support/streams.ts";

const item = (id: string, name: string, sectionNumber: number, kind: "resource" | "scorm" = "resource"): CourseItem => ({ id, kind, name, url: "u", sectionNumber });
const alfa: CourseContents = { sections: [{ number: 3, title: "Tres" }, { number: 1, title: "Uno" }], items: [item("a", "Tema A", 1), item("b", "Tema B", 1, "scorm"), item("c", "Tema C", 3)] };

function make(keys: KeyPress[], options: {
  contents?: Record<string, CourseContents | Error>;
  report?: (items: readonly CourseItem[], logger: TuiLogger) => BatchReport | Promise<BatchReport>;
  courses?: Array<{ id: string; name: string }>;
  signal?: AbortSignal;
} = {}) {
  const platform = new FakePlatform();
  platform.courses = options.courses ?? [{ id: "2", name: "Beta" }, { id: "1", name: "Alfa" }];
  platform.contents = options.contents ?? { "1": alfa, "2": { sections: [], items: [] } };
  const catalog = new CatalogService({ platform, store: new CompressedStore({ redactor: new Redactor() }), locale: "en", tracer: new NullTracer() });
  const terminal = new ScriptedTerminal(keys);
  const logger = new TuiLogger();
  const stdout = new CapturedStream();
  const stderr = new CapturedStream();
  const calls: Array<{ items: string[]; dest: string }> = [];
  const batch = {
    run: async (items: readonly CourseItem[], dest: string) => {
      calls.push({ items: items.map((i) => i.id), dest });
      return options.report ? options.report(items, logger) : ok(items);
    },
  };
  const app = new TuiApplication({
    terminal, catalog, batch, logger, messages: en, stdout, stderr, cwd: "carpeta-actual", animations: asciiAnimations,
    namer: new FileNamer({ fallbackName: "archivo", maxNameBytes: 100 }),
    printer: new ReportPrinter({ logger: new MemoryLogger(), messages: en }),
    layout: new FrameLayout({ colors: false }),
    signal: options.signal,
  });
  return { app, terminal, stdout, stderr, calls, platform };
}
const outcomes = (items: readonly CourseItem[]): ItemOutcome[] => items.map((it) => ({ item: it, status: "downloaded", path: `p/${it.id}`, bytes: 1 }));
const ok = (items: readonly CourseItem[]): BatchReport => ({ outcomes: outcomes(items), downloaded: items.length, skipped: 0, failed: 0, aborted: false });

describe("TuiApplication downloads", () => {
  it("downloads selected course materials to the current directory after confirmation", async () => {
    const { app, terminal, stdout, stderr, calls } = make([
      key("enter"), // Open Alfa, the first course alphabetically.
      key("space"), key("down"), key("space"), // Select Tema A and Tema B.
      key("enter"), key("enter"), key("enter"), // Continue, confirm, and use the current folder.
    ]);
    assert.equal(await app.run(), 0);
    assert.deepEqual(calls, [{ items: ["a", "b"], dest: "carpeta-actual/content/Alfa" }]);
    assert.equal(stdout.output, "Download complete. New files: 2, already present: 0. Destination: carpeta-actual/content\n");
    assert.equal(stderr.output, "");
    assert.deepEqual([terminal.opened, terminal.closed, terminal.remainingKeys], [1, 1, 0]);

    const frames = terminal.allFrames();
    assert.match(frames, /Loading courses\.\.\./);
    assert.match(frames, /> \[ \] Alfa\n  \[ \] Beta/);
    assert.match(frames, /Loading materials for "Alfa"\.\.\./);
    assert.ok(frames.indexOf("Section 1 - Uno") < frames.indexOf("Section 3 - Tres"));
    assert.match(frames, /Confirm download \(2 selected\)/);
    assert.match(frames, /Current directory \(/);
    assert.match(frames, /Downloading 0\/2/);
  });

  it("shows the current material name and progress bar", async () => {
    const { app, terminal } = make([key("enter"), ...chars("A"), key("enter"), key("enter"), key("enter")], {
      report: (items, logger) => {
        logger.progress({ done: 1, total: items.length, label: "Tema A" });
        return ok(items);
      },
    });
    await app.run();
    assert.match(terminal.allFrames(), /Downloading 1\/3: Tema A\n[\s\S]*█+░+ 1\/3/);
  });

  it("uses the custom destination entered by the user", async () => {
    const { app, calls } = make([key("enter"), key("space"), key("enter"), key("enter"), key("down"), key("enter"), ...chars("mi material"), key("enter")]);
    assert.equal(await app.run(), 0);
    assert.equal(calls[0]!.dest, "mi material/content/Alfa");
  });

  it("reports the number of files skipped because they already exist", async () => {
    const { app, stdout } = make([key("enter"), key("space"), key("enter"), key("enter"), key("enter")], {
      report: (items) => ({ outcomes: [{ item: items[0]!, status: "skipped", path: "p" }], downloaded: 0, skipped: 1, failed: 0, aborted: false }),
    });
    assert.equal(await app.run(), 0);
    assert.match(stdout.output, /New files: 0, already present: 1/);
  });

  it("animates the bear and hoop for three cycles", async () => {
    const { app, terminal } = make([key("enter"), key("space"), key("enter"), key("enter"), key("enter")]);
    assert.equal(await app.run(), 0);
    const frames = terminal.frames.filter((frame) => frame[0] === "Mulțumesc!");
    assert.equal(frames.length, 9);
    const { columns, rows } = terminal.size();
    const art = asciiAnimations.farewell.frames;
    assert.equal(new Set(art.map((frame) => frame.join("\n"))).size, 3);
    for (const [index, frame] of art.entries()) {
      const fitted = fitTerminalFrame(frame, columns - 1, rows - 5);
      assert.deepEqual(frames[index]!.slice(3, 3 + fitted.length), fitted);
    }
    assert.deepEqual(frames.slice(0, 3), frames.slice(6, 9));
  });

  it("continues when one selected course has no materials", async () => {
    const { app, terminal, calls } = make([
      ...chars("A"), key("enter"), key("space"), key("enter"),
      key("space"), key("enter"), key("enter"), key("enter"),
    ]);
    assert.equal(await app.run(), 0);
    assert.match(terminal.allFrames(), /This course has no downloadable materials/);
    assert.deepEqual(calls, [{ items: ["a"], dest: "carpeta-actual/content/Alfa" }]);
  });

  it("returns to the course list when none of the selected courses have materials", async () => {
    const empty: CourseContents = { sections: [], items: [] };
    const { app, terminal, calls } = make([
      ...chars("A"), key("enter"), key("enter"), key("enter"), key("escape"),
    ], { contents: { "1": empty, "2": empty } });
    assert.equal(await app.run(), 130);
    assert.match(terminal.lastFrame, /Your courses[\s\S]*\[x\] Alfa[\s\S]*\[x\] Beta/);
    assert.deepEqual(calls, []);
  });
});

describe("TuiApplication navigation", () => {
  it("keeps selections when navigating back with Escape", async () => {
    const { app, terminal, calls } = make([
      key("enter"), key("space"), key("enter"), // Open the course, select A, and reach the confirmation screen.
      key("escape"), // Return to the item list.
      key("down"), key("space"), key("enter"), // Select B as well and continue.
      key("enter"), // Confirm the selection.
      key("escape"), // Return from the destination screen to confirmation.
      key("enter"), key("enter"), // Confirm again and use the current folder.
    ]);
    assert.equal(await app.run(), 0);
    assert.deepEqual(calls[0]!.items, ["a", "b"]);
    assert.match(terminal.allFrames(), /\[x\] Tema A/);
  });

  it("keeps unconfirmed selections when moving between courses with Escape", async () => {
    const { app, terminal, calls } = make([
      key("space"), key("down"), key("space"), key("enter"),
      key("space"), key("enter"),
      key("space"), key("escape"),
      key("enter"), key("enter"), key("enter"), key("enter"),
    ], { contents: { "1": alfa, "2": { sections: [{ number: 1, title: "S" }], items: [item("z", "Z", 1)] } } });
    assert.equal(await app.run(), 0);
    assert.match(terminal.allFrames(), /Course 2 of 2/);
    assert.deepEqual(calls, [{ items: ["a"], dest: "carpeta-actual/content/Alfa" }, { items: ["z"], dest: "carpeta-actual/content/Beta" }]);
  });

  it("returns to the course list with Escape and allows another course to be opened", async () => {
    const { app, terminal, calls } = make([key("enter"), key("escape"), key("down"), key("enter"), key("escape"), key("escape")], {
      contents: { "1": alfa, "2": { sections: [{ number: 1, title: "Vacía" }], items: [] } },
    });
    assert.equal(await app.run(), 130);
    assert.match(terminal.allFrames(), /has no downloadable materials/);
    assert.deepEqual(calls, []);
  });

  it("returns from path entry to the destination list and then to confirmation", async () => {
    const { app, calls } = make([
      key("enter"), key("space"), key("enter"), key("enter"),
      key("down"), key("enter"), key("escape"), // Open path entry and return to the destination list.
      key("escape"), // Return to confirmation.
      key("enter"), key("enter"), // Confirm and use the current folder.
    ]);
    assert.equal(await app.run(), 0);
    assert.equal(calls[0]!.dest, "carpeta-actual/content/Alfa");
  });

  it("restores checked items when a course is reopened", async () => {
    const { app, terminal, calls } = make([
      key("enter"), key("space"), key("enter"),
      key("escape"), key("escape"),
      key("enter"), key("enter"), key("enter"), key("enter"),
    ]);
    assert.equal(await app.run(), 0);
    assert.match(terminal.allFrames(), /\[x\] Tema A/);
    assert.deepEqual(calls, [{ items: ["a"], dest: "carpeta-actual/content/Alfa" }]);
  });

  it("maintains independent selections when alternating between courses", async () => {
    const { app, terminal, calls } = make([
      key("enter"), key("space"), key("escape"),
      key("down"), key("enter"), key("space"), key("escape"),
      key("enter"), key("escape"),
      key("down"), key("enter"), key("enter"), key("enter"), key("enter"),
    ], { contents: { "1": alfa, "2": { sections: [{ number: 1, title: "S" }], items: [item("a", "Z", 1)] } } });
    assert.equal(await app.run(), 0);
    const beta = terminal.frames.filter((frame) => frame[0]?.startsWith("Beta - Select materials"));
    assert.match(beta[0]!.join("\n"), /\[ \] Z/);
    assert.match(beta.at(-1)!.join("\n"), /\[x\] Z/);
    assert.deepEqual(calls, [
      { items: ["a"], dest: "carpeta-actual/content/Alfa" },
      { items: ["a"], dest: "carpeta-actual/content/Beta" },
    ]);
  });

  it("excludes selected materials when their course is unchecked", async () => {
    const { app, terminal, calls } = make([
      key("enter"), key("space"), key("escape"),
      key("space"), key("down"), key("enter"),
      key("space"), key("enter"), key("enter"), key("enter"),
    ], { contents: { "1": alfa, "2": { sections: [{ number: 1, title: "S" }], items: [item("z", "Z", 1)] } } });
    assert.equal(await app.run(), 0);
    assert.match(terminal.allFrames(), /Courses selected: 1[\s\S]*\[x\] Alfa[\s\S]*Courses selected: 0/);
    assert.deepEqual(calls, [{ items: ["z"], dest: "carpeta-actual/content/Beta" }]);
  });
});

describe("TuiApplication cancellation and errors", () => {
  it("cancels from the selection flow with exit code 130 and restores the terminal", async () => {
    for (const script of [[key("escape")], [key("ctrl-c")], [key("enter"), key("ctrl-c")], [key("enter"), key("space"), key("enter"), key("ctrl-c")], [key("enter"), key("space"), key("enter"), key("enter"), key("ctrl-c")], [key("enter"), key("space"), key("enter"), key("enter"), key("down"), key("enter"), key("ctrl-c")]]) {
      const { app, terminal, stderr } = make(script);
      assert.equal(await app.run(), 130, JSON.stringify(script));
      assert.equal(stderr.output, "Cancelled.\n");
      assert.equal(terminal.closed, 1);
    }
  });

  it("shows a notice when there are no courses and exits on Escape", async () => {
    const { app, terminal } = make([key("enter"), key("escape")], { courses: [] });
    assert.equal(await app.run(), 130);
    assert.match(terminal.allFrames(), /No courses to show/);
  });

  it("restores the terminal on download interruption and preserves the signal reason", async () => {
    for (const reason of [130, 143]) {
      const controller = new AbortController();
      const { app, terminal, stderr } = make([key("enter"), key("space"), key("enter"), key("enter"), key("enter")], {
        signal: controller.signal,
        report: () => {
          controller.abort(reason);
          controller.signal.throwIfAborted();
          assert.fail("Expected download cancellation");
        },
      });
      const finished = app.run();
      if (reason === 130) {
        assert.equal(await finished, 130);
        assert.equal(stderr.output, "Cancelled.\n");
      } else {
        await assert.rejects(finished, (error: unknown) => error === reason);
      }
      assert.deepEqual([terminal.opened, terminal.closed], [1, 1]);
      assert.ok(!terminal.allFrames().includes("Mulțumesc!"));
    }
  });

  it("propagates loading errors and restores the terminal", async () => {
    const { app, terminal } = make([key("enter")], { contents: { "1": new AuthenticationError("sesión"), "2": alfa } });
    await assert.rejects(app.run(), AuthenticationError);
    assert.deepEqual([terminal.opened, terminal.closed], [1, 1]);
  });

  it("shows download failures, prints the summary, and exits with code 1", async () => {
    const failing = (items: readonly CourseItem[]): BatchReport => ({
      outcomes: [
        { item: items[0]!, status: "downloaded", path: "p", bytes: 1 },
        { item: items[1]!, status: "failed", error: new DownloadError("no network"), authentication: false },
      ],
      downloaded: 1, skipped: 0, failed: 1, aborted: false,
    });
    const { app, terminal, stdout, stderr } = make([key("enter"), ...chars("A"), key("enter"), key("enter"), key("enter"), key("space")], { report: failing });
    assert.equal(await app.run(), 1);
    assert.match(terminal.allFrames(), /Some downloads failed[\s\S]*Failed to download "Tema B": no network/);
    assert.match(stderr.output, /Failed to download "Tema B": no network[\s\S]*Downloaded: 1 \| Skipped: 0 \| Failed: 1/);
    assert.equal(stdout.output, "");
    assert.equal(terminal.remainingKeys, 0);
  });

  it("reports an expired session and exits with code 3", async () => {
    const aborted = (items: readonly CourseItem[]): BatchReport => ({
      outcomes: [{ item: items[0]!, status: "failed", error: new AuthenticationError("sesión"), authentication: true }],
      downloaded: 0, skipped: 0, failed: 1, aborted: true,
    });
    const { app, stderr } = make([key("enter"), key("space"), key("enter"), key("enter"), key("enter"), key("enter")], { report: aborted });
    assert.equal(await app.run(), 3);
    assert.match(stderr.output, /The Moodle session expired/);
  });

  it("preserves the batch exit code when Ctrl+C dismisses the failure screen", async () => {
    const failing = (items: readonly CourseItem[]): BatchReport => ({
      outcomes: [{ item: items[0]!, status: "failed", error: new DownloadError("x"), authentication: false }],
      downloaded: 0, skipped: 0, failed: 1, aborted: false,
    });
    const { app } = make([key("enter"), key("space"), key("enter"), key("enter"), key("enter"), key("ctrl-c")], { report: failing });
    assert.equal(await app.run(), 1);
  });
});

describe("CookiePrompt", () => {
  const make2 = (keys: KeyPress[]) => {
    const terminal = new ScriptedTerminal(keys);
    return { terminal, prompt: new CookiePrompt({ terminal, messages: en, layout: new FrameLayout({ colors: false }) }) };
  };

  it("masks the cookie entry, returns the value, and restores the terminal", async () => {
    const { terminal, prompt } = make2([...chars("MoodleSession=abc123"), key("enter")]);
    assert.equal(await prompt.ask(), "MoodleSession=abc123");
    assert.ok(!terminal.allFrames().includes("abc123"));
    assert.match(terminal.allFrames(), /Moodle session cookie required[\s\S]*Cookie: •{20}▌/);
    assert.deepEqual([terminal.opened, terminal.closed], [1, 1]);
  });

  it("returns undefined when Escape or Ctrl+C dismisses the prompt", async () => {
    assert.equal(await make2([key("escape")]).prompt.ask(), undefined);
    assert.equal(await make2([key("ctrl-c")]).prompt.ask(), undefined);
  });
});
