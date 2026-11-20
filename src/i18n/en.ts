import type { Messages } from "./Messages.ts";

export const en: Messages = {
  locale: "en",

  common: {
    untitled: () => "untitled",
    defaultFileName: () => "file",
  },

  options: {
    out: "Output file. SCORM conversions use the deck title by default.",
    "out-dir": "Directory for automatically named PDFs (default: current directory).",
    concurrency: "Number of concurrent downloads, from 1 to 32 (default: 6).",
    "base-url": "Moodle base URL. The host determines which profile to use.",
    entry: "SCORM entry document (default: index.html).",
    revision: "SCORM content revision. Detected automatically by default.",
    platform: "Moodle profile ID or base URL (default: ro.utcluj.kb).",
    lang: "Output language (default: en).",
    trace: "Save a diagnostic trace with redacted response snapshots.",
    "trace-dir": "Save a trace in this directory (default: scorm-trace-<id>).",
    json: "Print JSON.",
    week: "Comma-separated section numbers to download, such as 1,3.",
    item: "Comma-separated item IDs to download.",
    all: "Download all available materials from the course.",
    dest: "Download directory (default: current directory).",
    quiet: "Suppress progress messages.",
    help: "Show this help.",
    version: "Show the version.",
    prepare: "Download and verify the codec archives for offline use.",
    cols: "ASCII columns, from 1 to 500.",
    fps: "ASCII frames per second, up to 60.",
    scale: "Pixel scale for image and video output, from 1 to 8.",
    gamma: "Gamma correction (default: 1).",
    tone: "Weight given to brightness when matching glyphs (default: 1).",
    aspect: "Width-to-height ratio of a glyph cell.",
    chars: "Printable ASCII characters to use as glyphs.",
    "max-frames": "Maximum number of frames to process.",
    color: "Set a foreground color for each cell.",
    bg: "Set foreground and background colors for each cell.",
    invert: "Invert brightness for a light background.",
    loop: "Repeat playback in the terminal.",
    mute: "Omit audio from video output.",
  },

  help: {
    values: { file: "file", folder: "directory", path: "path", list: "list", number: "n", text: "text", url: "url", code: "code", platform: "id|url" },
    intro: (p) => [
      `Usage: ${p.program} [command] [options]`,
      "",
      "Download course materials from Moodle. Run without a command in a terminal",
      "to choose courses and materials interactively.",
      "",
    ],
    commandsHeading: () => "Commands:",
    commandLines: (p) => [
      `  ${p.program}                       Open the interactive selector`,
      `  ${p.program} <id | URL>            Convert a SCORM slide deck to PDF`,
      `  ${p.program} courses               List enrolled courses`,
      `  ${p.program} items <course>        List sections and materials in a course`,
      `  ${p.program} get <course>          Download course materials`,
      `  ${p.program} diagnose              Check the Moodle connection and save a trace`,
      `  ${p.program} ascii <input>         Convert images and videos to ASCII`,
    ],
    globalHeading: () => "Global options:",
    scormHeading: () => "SCORM options for <id | URL>:",
    listHeading: () => "Listing options for courses and items:",
    getHeading: () => "Download options for get:",
    asciiHeading: () => "ASCII options:",
    asciiIntro: (p) => [
      `Usage: ${p.program} ascii <input> [options]`,
      `       ${p.program} ascii --prepare`,
      "Read JPEG, PNG, WebP, GIF, MP4, or WebM from a file or an HTTP(S) URL.",
      "Export .txt, .ansi, .json, .html, .png, .gif, .mp4, .webm, .mov, .mkv, or .avi.",
      "Without --out, play in the terminal or print the first frame to redirected output.",
    ],
    asciiEnvironment: () => "Set SCORM_ASCII_CACHE to change where codec archives are stored.",
    environment: () => [
      "Environment:",
      "  MOODLE_COOKIE    Moodle session cookie. Use the Cookie header, a name=value pair,",
      "                   or the bare MoodleSession value.",
      "  MOODLE_BASE_URL  Moodle base URL. The --base-url flag takes precedence.",
      "  SCORM_PLATFORM   Same as --platform.",
      "  SCORM_LANG       Same as --lang.",
      "  SCORM_TRACE      Set to 1 to enable --trace.",
    ],
    exitCodes: () => [
      "Exit codes:",
      "  0  Success",
      "  1  Download or processing error",
      "  2  Invalid usage",
      "  3  Invalid Moodle session",
      "  130  Cancelled with Ctrl+C",
    ],
    examples: (p) => [
      "Examples:",
      `  ${p.program}`,
      `  ${p.program} 10067`,
      `  ${p.program} courses`,
      `  ${p.program} get algorithms --week 1,3 --dest materials`,
      `  ${p.program} https://kb.cunbm.utcluj.ro/pluginfile.php/10067/mod_scorm/content/3/index.html`,
    ],
  },

  cli: {
    unsupportedLocale: (p) => `Unsupported language "${p.locale}". Available: ${p.supported}.`,
    tooManyTargets: () => "Specify one SCORM ID or URL.",
    notIdNorUrl: (p) => `"${p.raw}" is not a numeric ID or a pluginfile.php URL.`,
    badPluginfileUrl: (p) =>
      `Expected a URL ending in /pluginfile.php/<id>/mod_scorm/content/<revision>/<file>. Received "${p.raw}".`,
    integerRange: (p) => `${p.label} must be an integer from ${p.min} to ${p.max}. Received "${p.raw}".`,
    scormIdLabel: () => "The SCORM ID",
    entryLabelUrl: () => "The entry path in the URL",
    unsafeEntry: (p) =>
      `${p.label} must be a relative path within the package, without '..', '//', '\\', '?' or '#'. Received "${p.raw}".`,
    baseUrlInvalid: (p) => `Invalid base URL in ${p.source}.`,
    baseUrlCredentials: (p) => `The base URL in ${p.source} cannot contain a username or password.`,
    baseUrlInsecure: (p) =>
      `The base URL in ${p.source} must use HTTPS. HTTP is allowed only on localhost. Received "${p.raw}".`,
    sourceUrlGiven: () => "the supplied URL",
    outAndOutDir: () => "Use either --out or --out-dir.",
    unknownOption: (p) => `Unknown option ${p.raw}.${p.suggestion}`,
    didYouMean: (p) => ` Did you mean --${p.name}?`,
    optionRepeated: (p) => `Option --${p.name} was specified more than once.`,
    optionNeedsValue: (p) => `Option --${p.name} requires a value.`,
    optionNoValue: (p) => `Option --${p.name} does not take a value.`,
    missingCourse: (p) => `Specify a course ID or part of its name for ${p.command}.`,
    unexpectedArguments: (p) => `Unexpected arguments for ${p.command}.`,
    listInvalid: (p) => `--${p.name} requires a comma-separated list of integers. Received "${p.raw}".`,
    allConflicts: () => "--all cannot be combined with --week or --item.",
    nothingSelected: () => "Nothing to download. Use --all, --week, or --item.",
    tuiNeedsTerminal: () =>
      "The interactive selector requires a terminal. Use a command such as courses, items, or get, or supply a SCORM ID.",
    courseNotFound: (p) => `No course matches "${p.query}".`,
    courseAmbiguous: (p) => `"${p.query}" matches multiple courses. Use a course ID: ${p.matches}`,
    asciiMissingInput: () => "Specify an image or video for ascii.",
    asciiTooManyInputs: () => "ascii accepts one image or video.",
    asciiPrepareOnly: () => "Use --prepare by itself without an input or conversion options.",
    asciiInvalidNumber: (p) => `Value out of range for --${p.name}: "${p.raw}".`,
  },

  ascii: {
    unsupportedPlatform: (p) => `The ASCII converter is unavailable for ${p.target}. Supported platforms are macOS and Linux on x64 and arm64.`,
    preparationFailed: (p) => `Could not download ${p.tool} (HTTP ${p.status}).`,
    invalidArchive: (p) => `The tool archive for ${p.tool} did not match the verified build.`,
    missingDependency: () => "The ASCII archive reader is missing. Run npm ci or bun install.",
    prepared: () => "ASCII converter ready for offline use.",
  },

  commands: {
    weekHeading: (p) => (p.title === "" ? `Section ${p.number}` : `Section ${p.number} - ${p.title}`),
    emptyWeek: () => "  (no downloadable materials)",
    itemLine: (p) => `  [${p.kind}] ${p.id}  ${p.name}`,
    kindResource: () => "resource",
    kindScorm: () => "scorm",
    skipped: (p) => `Skipped (already exists): ${p.path}`,
    failed: (p) => `Failed to download "${p.name}": ${p.detail}`,
    summary: (p) => `Downloaded: ${p.downloaded} | Skipped: ${p.skipped} | Failed: ${p.failed}`,
    abortedBySession: () => "The Moodle session expired. Remaining downloads were cancelled.",
    diagnoseOk: (p) => `OK  ${p.step}: ${p.detail}`,
    diagnoseFailed: (p) => `FAIL  ${p.step}: ${p.detail}`,
    stepCourses: () => "List courses",
    stepContents: () => "Read course contents",
    stepResource: () => "Resolve a resource",
    stepScorm: () => "Resolve a SCORM",
    detailCourses: (p) => `Courses found: ${p.count}`,
    detailContents: (p) => `Sections: ${p.sections}, items: ${p.items}`,
    detailResource: (p) => `"${p.name}" (${p.bytes} bytes)`,
    detailScorm: (p) => `"${p.name}"`,
    detailNothingToTry: () => "nothing available to check",
    diagnoseTrace: (p) => `Full trace saved to ${p.path}`,
  },

  tui: {
    loadingCourses: () => "Loading courses...",
    loadingContents: (p) => `Loading materials for "${p.course}"...`,
    coursesTitle: () => "Your courses (alphabetical order)",
    markedCourses: (p) => `Courses selected: ${p.count}`,
    noCourses: () => "No courses to show.",
    itemsTitle: (p) => `${p.course} - Select materials to download`,
    coursePosition: (p) => `Course ${p.current} of ${p.total}`,
    noItems: () => "This course has no downloadable materials.",
    nothingMarked: () => "Press Space to select at least one item.",
    selectedCount: (p) => `${p.count} selected`,
    confirmTitle: (p) => `Confirm download (${p.count} selected)`,
    destinationTitle: () => "Where should the files be saved?",
    destinationCurrent: (p) => `Current directory (${p.path})`,
    destinationOther: () => "Enter another path...",
    pathTitle: () => "Download directory",
    pathLabel: () => "Path:",
    cookieTitle: () => "Moodle session cookie required",
    cookieLines: () => [
      "Sign in to Moodle in your browser. Open Developer Tools and select Network.",
      "Copy the Cookie header from a Moodle request. The value stays in memory.",
    ],
    cookieLabel: () => "Cookie:",
    keysList: () => "Up/Down move | Enter select | Esc exit",
    keysCourses: () => "Up/Down move | Space select | A all | Enter next | Esc exit",
    keysEmptyCourse: () => "Enter next | Esc back",
    keysItems: () => "Up/Down move | Space select | a section | A all | Enter next | Esc back",
    keysConfirm: () => "Up/Down scroll | Enter download | Esc back",
    keysPrompt: () => "Enter confirm | Esc back",
    keysMessage: () => "Press any key to exit",
    downloading: (p) => `Downloading ${p.done}/${p.total}: ${p.label}`,
    errorsTitle: () => "Some downloads failed",
    unexpectedTitle: () => "Could not continue",
    success: (p) => `Download complete. New files: ${p.downloaded}, already present: ${p.skipped}. Destination: ${p.dest}`,
    farewell: () => "Mulțumesc!",
    cancelled: () => "Cancelled.",
  },

  trace: {
    saved: (p) => `Trace saved to ${p.path}`,
    enableHint: () => "Run again with --trace to save a diagnostic trace with redacted responses.",
    unavailable: () => "Could not write the trace to the requested directory.",
  },

  app: {
    errorPrefix: () => "ERROR:",
    usageHint: () => "Run with --help for usage.",
    unexpectedError: (p) => `Unexpected error: ${p.detail}`,
    done: (p) => `Done: ${p.pages} pages, ${p.mib} MiB`,
  },

  session: {
    cookieMissing: () => "Set MOODLE_COOKIE to your Moodle session cookie in the environment or in a .env file.",
    cookieInvalidChars: () => "MOODLE_COOKIE contains invalid characters. Use one line of printable ASCII.",
    blockedOrigin: (p) =>
      `Blocked a Moodle request to another origin (${p.origin}). If this is a sign-in provider, renew the Moodle session.`,
    tooManyRedirects: (p) => `Too many redirects for ${p.path}.`,
    redirectWithoutLocation: (p) => `Redirect from ${p.path} has no Location header.`,
    postRedirect: (p) => `Unexpected redirect on POST to ${p.path}.`,
    invalidLocation: (p) => `Invalid redirect location from ${p.path}.`,
    notFound: (p) => `Resource not found on the server: ${p.path}`,
    httpStatus: (p) => `HTTP ${p.status} at ${p.path}.`,
    authFailed: (p) =>
      "Moodle rejected the session.\n" +
      `  Cookies sent (names only): ${p.cookieNames}\n` +
      "  Sign in again and copy the full Cookie header from a Moodle request in the Network tab of Developer Tools.",
  },

  platform: {
    notJson: (p) => `The response from ${p.path} is not JSON.`,
    sesskeyNotFound: (p) =>
      `No session key (sesskey) was found on the courses page ("${p.title}"). Check that the cookie belongs to an active session.`,
    invalidSessionKey: () => "Moodle rejected the session key (sesskey). Sign in again and copy a fresh cookie.",
    serviceError: (p) => `Moodle returned error ${p.code}: ${p.detail}`,
    unexpectedShape: (p) => `Unexpected Moodle response (${p.what}). Received: ${p.shape}`,
    contentsUnavailable: (p) => `Could not read the materials for "${p.course}". Tried: ${p.attempts}`,
    resourceNotResolved: (p) => `Could not locate the file for "${p.name}". ${p.detail}`,
    scormLaunchNotFound: (p) => `Could not find launch details for SCORM "${p.name}". ${p.detail}`,
    scormEntryNotFound: (p) => `Could not find the entry document for SCORM "${p.name}". ${p.detail}`,
    pageHints: (p) => `Page title: "${p.title}". ${p.details}`,
    extensionUnknown: (p) => `Unknown platform "${p.spec}". Use ${p.known} or a Moodle URL.`,
  },

  locator: {
    probingRevisions: (p) => `Revision 1 was not found. Checking revisions 0 through ${p.max}...`,
    explicitRevisionMissing: (p) =>
      `Could not find ${p.path}. Check the ID or omit --revision to detect it automatically.`,
    revisionsNotFound: (p) =>
      `Could not find ${p.entry} for SCORM ${p.id} (revisions 0..${p.max}). ` +
      "Check the ID and use a session with access to the course.",
  },

  slides: {
    arrayMissing: (p) =>
      `Could not find const SLIDES = [...] on page "${p.title}". The session may have expired or the SCORM format may be unsupported.`,
    arrayEmpty: () => "The SLIDES array is empty.",
    tooMany: (p) => `SCORM declares ${p.count} slides. The limit is ${p.max}.`,
    badJson: (p) => `Could not parse the SLIDES array: ${p.detail}`,
    badSrc: (p) => `Slide ${p.position} has no valid src property.`,
  },

  jpeg: {
    noStartMarker: (p) => `Slide ${p.slide} is missing the JPEG SOI marker.`,
    unreadable: (p) => `Could not read JPEG dimensions for slide ${p.slide}.`,
    badDimensions: (p) => `Invalid JPEG dimensions for slide ${p.slide}.`,
    unsupportedComponents: (p) => `Slide ${p.slide} uses ${p.components} JPEG components. Use grayscale or RGB images.`,
  },

  pdf: {
    noImages: () => "No images to include in the PDF.",
  },

  downloader: {
    deckTooLarge: (p) => `Combined slide size exceeds the ${p.max}-byte limit.`,
    slideLabel: (p) => `slide ${p.position}`,
    retrying: (p) => `${p.label}: retry ${p.attempt}/${p.retries} (${p.reason})`,
    unexpectedContentType: (p) => `Unexpected Content-Type (${p.contentType}). Check whether the session has expired.`,
    notJpeg: () => "The downloaded slide is not a valid JPEG.",
    invalidSrc: (p) => `Invalid src: "${p.src}".`,
    slideFailed: (p) => `Slide ${p.position}${p.title}: ${p.detail}`,
  },

  convert: {
    located: (p) => `Found SCORM ${p.id} (revision ${p.revision}): ${p.title}`,
    slidesFound: (p) => `Downloading ${p.count} slides...`,
    buildingPdf: () => "Building the PDF...",
  },

  http: {
    networkFailure: (p) => `Network error while requesting ${p.path}: ${p.name}: ${p.detail}`,
    responseTooLarge: (p) => `The response from ${p.path} exceeds the ${p.max}-byte limit.`,
  },

  sink: {
    writeFailed: (p) => `Could not write ${p.target}: ${p.detail}`,
  },

  logger: {
    warningPrefix: () => "Warning:",
  },
};
