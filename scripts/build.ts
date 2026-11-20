import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { CliInterruptions, withProcessSignals } from "../src/cli/CliInterruptions.ts";

const run = promisify(execFile);
const entry = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const name = process.platform === "win32" ? "scorm-to-pdf.exe" : "scorm-to-pdf";

async function build(signal: AbortSignal): Promise<void> {
  await mkdir(dist, { recursive: true });
  const stage = await mkdtemp(join(dist, ".build-"));
  try {
    const binary = join(stage, name);
    await run(process.execPath, ["build", "--compile", entry, "--outfile", binary], {
      cwd: stage, signal, killSignal: "SIGKILL",
    });
    signal.throwIfAborted();
    await rename(binary, join(dist, name));
    console.log(`Built dist/${name}`);
  } finally {
    await rm(stage, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
  }
}

const interruptions = new CliInterruptions();
process.exitCode = await withProcessSignals(() => interruptions.run(build), (code) => { interruptions.request(code); });
