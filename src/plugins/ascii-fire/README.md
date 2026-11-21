# ascii-fire

Convert JPEG, PNG, static WebP, animated GIF, MP4, and WebM into ASCII. The engine matches the shape and brightness of each cell to a printable glyph. Terminal and raster output can use foreground and background colors.

## Usage

~~~sh
node src/main.ts ascii --help
node src/main.ts ascii src/plugins/ascii-fire/content/bear_hoop.png --invert -w 48
node src/main.ts ascii src/plugins/ascii-fire/content/wink_cat.gif --loop --color --fps 12
node src/main.ts ascii video.mp4 -o video-ascii.webm --bg --cols 100
~~~

Inputs can be local files or HTTP(S) URLs. ASCII conversion uses no Moodle session. Without an output path, animations play in a terminal and Ctrl+C restores the screen. If stdout is redirected, the converter writes the first frame. The older entry point at `src/extensions/ascii/main.ts` forwards to the same command.

| Output | Contents |
| --- | --- |
| `.txt`, `.ansi`, `.png` | First frame. |
| `.json`, `.html` | Animation and frame rate. The default frame limit is 600. |
| `.gif`, `.mp4`, `.webm`, `.mov`, `.mkv`, `.avi` | Rasterized frames. Video includes the first source audio track when available unless `--mute` is set. |

## Codec setup

The converter uses pinned [FFmpeg and FFprobe 9.0.2 builds from Martin Riedl](https://ffmpeg.martin-riedl.de/) for macOS and Linux on x64 and arm64. On first use it downloads the two ZIP archives and checks their SHA-256 digests. The verified archives stay in `.ascii-cache` in the current directory. Set `SCORM_ASCII_CACHE` to share a cache across working directories.

A conversion extracts the tools into a private temporary directory, invokes them by absolute path, and removes them before returning. Network inputs run with only the proxy and certificate settings they may need. A forced kill or an OS failure can leave temporary files.

Prepare the cache before going offline or building a standalone executable.

~~~sh
npm run ascii:prepare
npm run build
~~~

The standalone executable includes the ZIP reader and the interactive farewell and error animations. It can prepare a cache with `ascii --prepare` or use a populated `SCORM_ASCII_CACHE`.

## TypeScript API

~~~ts
import { fitAsciiFrame, renderAsciiClip } from "./src/plugins/ascii-fire/index.ts";

const clip = await renderAsciiClip("wink_cat.gif", { cols: 40, fps: 12 });
const firstFrame = fitAsciiFrame(clip.frames[0]!, 79, 20);
~~~

A clip has `cols`, `rows`, `fps`, and `frames`. Each frame contains plain ASCII lines. `AsciiEngine` also accepts RGB24 frames in memory. Use `openAsciiMedia` to iterate through frames and close the iterator when stopping early.

Run `npm run ascii:art` to regenerate the interactive animations from the bear, hammer, and startled boy images in [content](content). For codec integration tests, run `npm run ascii:prepare` followed by `SCORM_ASCII_TEST=1 npm test`.
