import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ASCII_TOOL_RELEASE } from "../../src/plugins/ascii-fire/runtime.ts";

export const asciiProject = fileURLToPath(new URL("../../", import.meta.url));
export const asciiCache = resolve(process.env.SCORM_ASCII_CACHE?.trim() || ".ascii-cache");
const build = join(asciiCache, ASCII_TOOL_RELEASE, process.platform + "-" + process.arch);
export const asciiSupported = (process.platform === "darwin" || process.platform === "linux") &&
  (process.arch === "arm64" || process.arch === "x64");
export const asciiIntegration = {
  skip: process.env.SCORM_ASCII_TEST === "1" || ["ffmpeg", "ffprobe"].every((tool) => existsSync(join(build, tool + ".zip")))
    ? false
    : "Run npm run ascii:prepare to enable codec tests.",
};

export const offline = {
  async get(): Promise<never> {
    throw new Error("ASCII tests require the codec archives to be prepared locally.");
  },
};

export const asciiAsset = (name: string) => join(asciiProject, "src/plugins/ascii-fire/content", name);
