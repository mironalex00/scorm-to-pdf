# scorm-to-pdf

Download files and SCORM slide decks from Moodle. The interactive selector can collect materials from several courses in one run. Direct downloads keep their original format, and JPEG slide decks become PDFs.

## Getting started

Use Node.js 22.18 or later, or Bun. Install dependencies with `npm ci` or `bun install --frozen-lockfile`. Start the interactive selector in a terminal.

~~~sh
node src/main.ts
~~~

If the Moodle session cookie is missing, the selector prompts for it with input hidden. For scripted commands, set `MOODLE_COOKIE` to the complete Cookie header, a name-value pair, or the bare MoodleSession value. Bun loads a local `.env` file automatically. Keep this file private and out of version control.

## Commands

| Command | Action |
| --- | --- |
| No command in a terminal | Select courses, select materials, then choose a destination. |
| `courses [--json]` | List enrolled courses. |
| `items <course> [--json]` | List the sections and downloadable materials in a course. Use its ID or part of its name. |
| `get <course> --all [--dest <path>]` | Download a course. Use `--week 1,3` or `--item 501,512` to select individual sections or materials. |
| `<SCORM ID or pluginfile URL>` | Convert one SCORM slide deck to PDF. |
| `diagnose` | Check course listings, course contents, and sample resource and SCORM downloads. Save a trace. |
| `ascii <input>` | Convert an image, GIF, or video to ASCII. See the [ascii-fire plugin](src/plugins/ascii-fire/README.md). |

Run `node src/main.ts --help` for options. Exit status is 0 for success, 1 for an operation that failed, 2 for invalid usage, and 3 when Moodle rejects the session. Cancel with Ctrl+C to exit with status 130.

## Interactive selection and files

Use the arrow keys to move, Space to toggle a course or item, A to toggle all, and Enter to advance. Press lowercase a on the materials screen to toggle the current section. Esc goes back and preserves selections for the current session. The review screen includes materials selected in every course. Clearing a course from the course list removes its selected materials.

The selector saves files as `<destination>/content/<course>/<section>/<material>/<file>`, including when only one course is selected. The `get` command writes directly to `<destination>/<section>/<file>`. Sections without titles use their numeric index. Colliding names receive suffixes such as `(2)`.

Course downloads keep existing files. They publish each completed file from a private staging directory using a hard link, so the destination filesystem must support hard links. Use a destination you control. The standalone SCORM and ASCII commands can replace the explicit output file.

## Moodle settings

The default installation is `ro.utcluj.kb`. Select another Moodle site with `--platform https://campus.example.org` or `--base-url https://campus.example.org/moodle/`. Remote Moodle sites require HTTPS. HTTP is available for loopback addresses used in development. `SCORM_PLATFORM` and `MOODLE_BASE_URL` provide equivalent environment settings.

Moodle installation profiles live under [src/extensions](src/extensions). The registry uses the standard Moodle adapter for hosts without a profile.

## Language

The CLI and interactive selector support English, Spanish, and Romanian offline. The default language comes from the system. Use `--lang ro` for one command or set `SCORM_LANG=ro` for your shell.

The lookup order is `--lang`, `SCORM_LANG`, `LC_ALL`, `LC_MESSAGES`, `LANG`, then the runtime's locale. A regional locale such as `es_MX.UTF-8` uses Spanish when there is no regional catalog. Unsupported languages and missing translations use the [English catalog](src/i18n/en.ts). Moodle titles, filenames, and JSON field names keep their original values.

## Plugins

The [application composition](src/composition/plugins.ts) registers the bundled plugins. Add a command by implementing [CommandPlugin](src/cli/CommandPlugin.ts) and registering it there. The host handles shared options, help, tracing, and cancellation. A command declares the environment settings it needs. The language provider implements [LanguagePlugin](src/i18n/LanguagePlugin.ts) and supplies typed messages to both core commands and plugins.

The standalone build includes `i18n` and `ascii-fire`. Changes to the registered plugins require a rebuild.

## Diagnostics and cleanup

Use `--trace`, `SCORM_TRACE=1`, `--trace-dir <path>`, or `diagnose` to save diagnostic events and selected response snapshots. The default path is `scorm-trace-<id>/`. Trace files are created with owner-only permissions on Unix-like systems. Common credentials are redacted, but snapshots can still contain course names, personal information, and fields specific to a Moodle installation. Review them before sharing.

Course catalog data is cached in memory for one command. Output staging directories and extracted codec executables are removed on completion, recoverable errors, and handled interrupts. Completed output files remain after cancellation. Filesystem errors, a power loss, or a forced kill can leave an empty output directory or a private staging directory. The ascii-fire plugin keeps verified ZIP archives for offline use.

## Development

~~~sh
npm ci
npm run typecheck
npm test
npm run ascii:prepare
npm run coverage
~~~

The suite uses synthetic Moodle data and starts a loopback HTTP server. The coverage command requires the media integration tests and checks 100% of lines, branches, and functions across executable files under [src](src), including the CLI entry points. Prepare the codec cache on a supported macOS or Linux host before running coverage. Set `SCORM_ASCII_CACHE` to use a cache prepared in another directory.

With Bun installed, `npm run build` produces a standalone executable in `dist/` and removes the compiler's staging files.

The converter supports Moodle file resources and SCORM slide decks with grayscale or RGB JPEGs. A file can be up to 200 MiB, an individual slide up to 25 MiB, and the slides in one deck up to 128 MiB combined.
