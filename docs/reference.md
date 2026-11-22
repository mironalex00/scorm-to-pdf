# Usage and development

## Moodle settings

For scripted commands, set `MOODLE_COOKIE` to the complete Cookie header, a name-value pair, or the bare MoodleSession value. Bun loads a local `.env` file automatically. Keep that file private and out of version control.

The default installation is `ro.utcluj.kb`. Use `--platform https://campus.example.org` or `--base-url https://campus.example.org/moodle/` to select another site. Remote sites require HTTPS. HTTP is allowed for loopback addresses. Use `SCORM_PLATFORM` or `MOODLE_BASE_URL` to set the equivalent option in the shell.

The registry uses the standard Moodle adapter for hosts without a profile. See the [installation profiles](../src/extensions).

## Interactive selection and downloads

Use the arrow keys to move, Space to toggle a course or item, uppercase A to toggle all, and Enter to advance. Press lowercase a on the materials screen to toggle the current section. Esc goes back and preserves the current selections. The review screen includes materials selected in every course. Unchecking a course clears its selected materials.

The selector saves files under `<destination>/content/<course>/<section>/<material>/<file>`, including when you select a single course. The `get` command writes to `<destination>/<section>/<file>`. Sections without a title use their numeric index. Colliding names receive suffixes such as `(2)`.

Use `get <course> --week 1,3` for selected sections or `get <course> --item 501,512` for individual materials. Use `--dest <path>` to set the download directory. The `courses` and `items` commands accept `--json`.

Course downloads keep existing files. Use a destination you control on a filesystem that supports hard links. The program writes each file to a private staging directory on the same filesystem, then publishes the completed file with a hard link. Standalone SCORM and ASCII conversions can replace the explicit output file.

The converter supports Moodle file resources and SCORM decks with grayscale or RGB JPEG slides. Limits are 200 MiB per resource, 25 MiB per slide, and 128 MiB for all slides in one deck.

## Language

The CLI supports English, Spanish, and Romanian offline. It checks `--lang`, `SCORM_LANG`, `LC_ALL`, `LC_MESSAGES`, `LANG`, and then the runtime locale, in that order. A regional setting such as `es_MX.UTF-8` uses Spanish when there is no matching regional catalog.

Unsupported languages and missing translations use English. Moodle titles, filenames, and JSON field names keep their original values. See the [English catalog](../src/i18n/en.ts).

## Diagnostics

`diagnose` checks course listings, course contents, and sample resource and SCORM downloads. Use `--trace`, `SCORM_TRACE=1`, or `--trace-dir <path>` to save diagnostic events and selected response snapshots during other commands. The default trace path is `scorm-trace-<id>/`. Trace files have owner-only permissions on Unix-like systems. The program redacts common credentials. Review snapshots before sharing them because they can contain course names, personal information, or fields specific to a Moodle installation.

Course catalog data is cached in memory for one command. Output staging directories and extracted codec executables are removed after completion, recoverable errors, and handled interrupts. Completed files remain after cancellation. A filesystem error, power loss, or forced kill can leave an empty output directory or private staging directory. The ASCII converter keeps verified ZIP archives for offline use.

| Exit status | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Download or processing failed |
| 2 | Invalid usage |
| 3 | Moodle rejected the session |
| 130 | Cancelled with Ctrl+C |

## Tests and builds

```sh
npm ci
npm run typecheck
npm test
npm run ascii:prepare
npm run coverage
```

The suite uses synthetic Moodle data and a local HTTP server. Coverage requires the media integration tests and checks 100% of lines, branches, and functions across executable files in `src`, including the CLI entry points. Prepare the codec cache on a supported macOS or Linux host. Use `SCORM_ASCII_CACHE` to point to a cache in another directory.

With Bun installed, `npm run build` creates a standalone executable in `dist/` and removes the compiler's staging files.

## Plugins

Implement a command with the [CommandPlugin contract](../src/cli/CommandPlugin.ts). The host handles shared options, help, tracing, and cancellation. Commands declare the environment settings they need. Implement a language provider with the [LanguagePlugin contract](../src/i18n/LanguagePlugin.ts).

The standalone build includes `i18n` and `ascii-fire`. Register bundled plugins in the composition module and rebuild when the registration changes. See the [application composition](../src/composition/plugins.ts).
