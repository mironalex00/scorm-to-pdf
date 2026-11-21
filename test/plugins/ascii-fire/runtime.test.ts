import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import type { HttpRequest } from "../../../src/application/ports.ts";
import { OutputError, UsageError } from "../../../src/domain/errors.ts";
import { en } from "../../../src/i18n/en.ts";
import { probe } from "../../../src/plugins/ascii-fire/media.ts";
import { ASCII_TOOL_RELEASE, extractTool, PortableMediaRuntime, withMediaTools } from "../../../src/plugins/ascii-fire/runtime.ts";
import { asciiAsset, asciiCache, asciiIntegration, offline } from "../../support/ascii.ts";
import { okResponse, statusResponse } from "../../support/fakes.ts";

const target = process.platform + "-" + process.arch;
const cacheSource = join(asciiCache, ASCII_TOOL_RELEASE, target);

async function workingDirectory(t: TestContext): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "ascii-runtime-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  return cwd;
}

function setEnvironment(t: TestContext, key: string, value: string): void {
  const previous = process.env[key];
  process.env[key] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  });
}

test("reports a missing ZIP reader before trying to fetch or extract archives", async (t) => {
  const cwd = await workingDirectory(t);
  const runtimeFile = new URL("../../../src/plugins/ascii-fire/runtime.ts", import.meta.url).href;
  const noDependencies = pathToFileURL(join(cwd, "entry.mjs")).href;
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      const missingReader = specifier === "fflate" && context.parentURL === runtimeFile;
      return nextResolve(specifier, missingReader ? { ...context, parentURL: noDependencies } : context);
    },
  });
  try {
    const runtime = new PortableMediaRuntime({ cwd, env: {}, http: offline });
    await assert.rejects(runtime.acquire(), (error: unknown) =>
      error instanceof UsageError && /archive reader is missing/.test(error.message) &&
      (error.cause as NodeJS.ErrnoException)?.code === "ERR_MODULE_NOT_FOUND");
    assert.deepEqual(await readdir(cwd), []);
  } finally {
    hook.deregister();
  }
});

test("extracts the named executable and rejects missing or empty entries", async () => {
  const { unzipSync, zipSync } = await import("fflate");
  const executable = Uint8Array.of(12, 34, 56);
  const readme = new TextEncoder().encode("Tool description");
  assert.deepEqual(extractTool("ffprobe", zipSync({ readme, ffprobe: executable }), unzipSync, en.ascii), executable);
  for (const archive of [zipSync({ readme }), zipSync({ ffprobe: new Uint8Array() })]) {
    assert.throws(() => extractTool("ffprobe", archive, unzipSync, en.ascii), {
      name: "OutputError",
      message: /ffprobe.*verified build/,
    });
  }
});

test("replaces a stale cache from verified downloads, then extracts and cleans up offline", asciiIntegration, async (t) => {
  const cwd = await workingDirectory(t);
  const cache = join(cwd, "tool-cache", ASCII_TOOL_RELEASE, target);
  await mkdir(cache, { recursive: true });
  await writeFile(join(cache, "ffmpeg.zip"), "interrupted previous copy");
  const downloads: HttpRequest[] = [];
  const controller = new AbortController();
  setEnvironment(t, "SCORM_ASCII_CACHE", " tool-cache ");
  const runtime = new PortableMediaRuntime({
    cwd,
    http: {
      async get(request) {
        downloads.push(request);
        return okResponse(await readFile(join(cacheSource, basename(request.url.pathname))), "application/zip");
      },
    },
  });
  await runtime.prepare(controller.signal);
  assert.deepEqual(downloads.map(({ url }) => basename(url.pathname)), ["ffmpeg.zip", "ffprobe.zip"]);
  for (const request of downloads) {
    assert.equal(request.url.origin, "https://ffmpeg.martin-riedl.de");
    assert.ok(request.url.pathname.includes("_" + ASCII_TOOL_RELEASE + "/"));
    assert.deepEqual(request.headers, {});
    assert.equal(request.signal, controller.signal);
  }
  assert.deepEqual((await readdir(cache)).sort(), ["ffmpeg.zip", "ffprobe.zip"]);

  const cachedRuntime = new PortableMediaRuntime({ cwd, env: { SCORM_ASCII_CACHE: "tool-cache" }, http: offline });
  await cachedRuntime.prepare();
  const failure = new Error("Conversion failed after inspecting the media");
  let extractedDirectory: string | undefined;
  await assert.rejects(withMediaTools(cachedRuntime, async (tools) => {
    extractedDirectory = dirname(tools.ffmpeg);
    assert.equal(dirname(tools.ffprobe), extractedDirectory);
    assert.deepEqual((await readdir(extractedDirectory)).sort(), ["ffmpeg", "ffprobe"]);
    assert.equal((await stat(tools.ffmpeg)).mode & 0o777, 0o700);
    assert.equal((await stat(tools.ffprobe)).mode & 0o777, 0o700);
    assert.equal((await probe(tools, asciiAsset("bear_hoop.png"))).still, true);
    throw failure;
  }), (error: unknown) => error === failure);
  assert.ok(extractedDirectory);
  await assert.rejects(stat(extractedDirectory), { code: "ENOENT" });
  assert.deepEqual((await readdir(cache)).sort(), ["ffmpeg.zip", "ffprobe.zip"]);
});

test("removes a partially extracted tool pair after a failed second download", asciiIntegration, async (t) => {
  const cwd = await workingDirectory(t);
  const cache = join(cwd, ".ascii-cache", ASCII_TOOL_RELEASE, target);
  const temporary = join(cwd, "tmp");
  await mkdir(cache, { recursive: true });
  await mkdir(temporary);
  await copyFile(join(cacheSource, "ffmpeg.zip"), join(cache, "ffmpeg.zip"));
  const downloads: string[] = [];
  const runtime = new PortableMediaRuntime({
    cwd,
    env: {},
    http: {
      async get({ url }) {
        downloads.push(basename(url.pathname));
        const staging = await readdir(temporary);
        assert.equal(staging.length, 1);
        assert.deepEqual(await readdir(join(temporary, staging[0]!)), ["ffmpeg"]);
        return statusResponse(503);
      },
    },
  });
  setEnvironment(t, "TMPDIR", temporary);
  await assert.rejects(runtime.acquire(), { name: "OutputError", message: /Could not download ffprobe \(HTTP 503\)/ });
  assert.deepEqual(downloads, ["ffprobe.zip"]);
  assert.deepEqual(await readdir(temporary), []);
  assert.deepEqual(await readdir(cache), ["ffmpeg.zip"]);
});

test("rejects an unverified download when the cached path is a directory", async (t) => {
  const cwd = await workingDirectory(t);
  const cacheEntry = join(cwd, ".ascii-cache", ASCII_TOOL_RELEASE, target, "ffmpeg.zip");
  await mkdir(cacheEntry, { recursive: true });
  const downloads: string[] = [];
  const runtime = new PortableMediaRuntime({
    cwd,
    env: {},
    http: {
      async get({ url }) {
        downloads.push(basename(url.pathname));
        return okResponse(Buffer.from("unverified archive"), "application/zip");
      },
    },
  });
  await assert.rejects(runtime.prepare(), (error: unknown) =>
    error instanceof OutputError && /ffmpeg.*verified build/.test(error.message));
  assert.deepEqual(downloads, ["ffmpeg.zip"]);
  assert.ok((await stat(cacheEntry)).isDirectory());
  assert.deepEqual(await readdir(cacheEntry), []);
});

test("propagates a cache filesystem error without downloading a replacement", async (t) => {
  const cwd = await workingDirectory(t);
  const blocked = join(cwd, ".ascii-cache");
  await writeFile(blocked, "not a directory");
  const runtime = new PortableMediaRuntime({ cwd, env: {}, http: offline });
  await assert.rejects(runtime.prepare(), { code: "ENOTDIR" });
  assert.equal(await readFile(blocked, "utf8"), "not a directory");
});

test("does not cache a response after cancellation", async (t) => {
  const cwd = await workingDirectory(t);
  const controller = new AbortController();
  const reason = new Error("Preparation cancelled");
  const runtime = new PortableMediaRuntime({
    cwd,
    env: {},
    http: {
      async get({ signal }) {
        assert.equal(signal, controller.signal);
        controller.abort(reason);
        return okResponse(Buffer.from("body received just after cancellation"));
      },
    },
  });
  const isReason = (error: unknown) => error === reason;
  await assert.rejects(runtime.prepare(controller.signal), isReason);
  assert.deepEqual(await readdir(cwd), []);
  await assert.rejects(runtime.acquire(controller.signal), isReason);
});

test("reports the codec families supported on an unsupported platform", async () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  assert.ok(platform);
  Object.defineProperty(process, "platform", { ...platform, value: "win32" });
  try {
    const runtime = new PortableMediaRuntime({ env: {}, http: offline });
    await assert.rejects(runtime.prepare(), (error: unknown) =>
      error instanceof UsageError &&
      error.message.includes("win32-" + process.arch) &&
      /macOS and Linux on x64 and arm64/.test(error.message));
  } finally {
    Object.defineProperty(process, "platform", platform);
  }
});
