# scorm-to-pdf

Download course files from Moodle and convert SCORM slide decks to PDF. The terminal selector lets you pick materials from several courses and save them in one run.

## Quick start

Install with Node.js 22.18 or later, then open the selector in a terminal.

```sh
npm ci
node src/main.ts
```

With Bun, use `bun install --frozen-lockfile` and `bun src/main.ts`.

When `MOODLE_COOKIE` is unset, the selector prompts for a session cookie with input hidden. Set the variable for scripts. Use `--base-url https://campus.example.org/moodle/` to select another Moodle installation.

## Commands

Pass one of these commands or arguments to `node src/main.ts`.

| Command | Action |
| --- | --- |
| `courses` | List enrolled courses. |
| `items <course>` | List downloadable materials for a course. |
| `get <course> --all` | Download a course by ID or name. |
| `<SCORM ID or pluginfile URL>` | Convert a slide deck to PDF. |
| `diagnose` | Check your Moodle session and save a diagnostic trace. |
| `ascii <input>` | Convert an image, GIF, or video to ASCII. |

Run `node src/main.ts --help` for options. The CLI uses your system language when English, Spanish, or Romanian is available. Use `--lang ro` to choose Romanian for one run.

## Reference

- [Usage, file layout, troubleshooting, and development](docs/reference.md)
- [ASCII conversion and codec setup](src/plugins/ascii-fire/README.md)
