import type { OptionName } from "../cli/optionNames.ts";
import type { ValueKind } from "../cli/optionSpecs.ts";

/**
 * Contrato de todos los textos visibles para el usuario. Cada idioma implementa esta interfaz
 * completa: el compilador rechaza un catálogo al que le falte un mensaje o le sobre un parámetro.
 * Los mensajes con datos son funciones que reciben ya formateados los valores (sin aritmética).
 */
export interface Messages {
  readonly locale: string;

  readonly common: {
    untitled(): string;
    defaultFileName(): string;
  };

  readonly options: Readonly<Record<OptionName, string>>;

  readonly help: {
    /** Cómo se llama en la ayuda el valor de cada opción: --out <archivo>. */
    readonly values: Readonly<Record<ValueKind, string>>;
    intro(p: { program: string }): string[];
    commandsHeading(): string;
    commandLines(p: { program: string }): string[];
    globalHeading(): string;
    scormHeading(): string;
    listHeading(): string;
    getHeading(): string;
    environment(): string[];
    exitCodes(): string[];
    examples(p: { program: string }): string[];
  };

  readonly cli: {
    unsupportedLocale(p: { locale: string; supported: string }): string;
    tooManyTargets(): string;
    notIdNorUrl(p: { raw: string }): string;
    badPluginfileUrl(p: { raw: string }): string;
    integerRange(p: { label: string; min: string; max: string; raw: string }): string;
    scormIdLabel(): string;
    entryLabelUrl(): string;
    unsafeEntry(p: { label: string; raw: string }): string;
    baseUrlInvalid(p: { source: string; raw: string }): string;
    baseUrlInsecure(p: { source: string; raw: string }): string;
    sourceUrlGiven(): string;
    outAndOutDir(): string;
    unknownOption(p: { raw: string; suggestion: string }): string;
    didYouMean(p: { name: string }): string;
    optionRepeated(p: { name: string }): string;
    optionNeedsValue(p: { name: string }): string;
    optionNoValue(p: { name: string }): string;
    missingCourse(p: { command: string }): string;
    unexpectedArguments(p: { command: string }): string;
    listInvalid(p: { name: string; raw: string }): string;
    allConflicts(): string;
    nothingSelected(): string;
    tuiNeedsTerminal(): string;
    courseNotFound(p: { query: string }): string;
    courseAmbiguous(p: { query: string; matches: string }): string;
  };

  readonly commands: {
    weekHeading(p: { number: string; title: string }): string;
    emptyWeek(): string;
    itemLine(p: { kind: string; id: string; name: string }): string;
    kindResource(): string;
    kindScorm(): string;
    skipped(p: { path: string }): string;
    failed(p: { name: string; detail: string }): string;
    summary(p: { downloaded: string; skipped: string; failed: string }): string;
    abortedBySession(): string;
    diagnoseOk(p: { step: string; detail: string }): string;
    diagnoseFailed(p: { step: string; detail: string }): string;
    stepCourses(): string;
    stepContents(): string;
    stepResource(): string;
    stepScorm(): string;
    detailCourses(p: { count: string }): string;
    detailContents(p: { sections: string; items: string }): string;
    detailResource(p: { name: string; bytes: string }): string;
    detailScorm(p: { name: string }): string;
    detailNothingToTry(): string;
    diagnoseTrace(p: { path: string }): string;
  };

  readonly tui: {
    loadingCourses(): string;
    loadingContents(p: { course: string }): string;
    coursesTitle(): string;
    markedCourses(p: { count: string }): string;
    noCourses(): string;
    itemsTitle(p: { course: string }): string;
    coursePosition(p: { current: string; total: string }): string;
    noItems(): string;
    nothingMarked(): string;
    selectedCount(p: { count: string }): string;
    confirmTitle(p: { count: string }): string;
    destinationTitle(): string;
    destinationCurrent(p: { path: string }): string;
    destinationOther(): string;
    pathTitle(): string;
    pathLabel(): string;
    cookieTitle(): string;
    cookieLines(): string[];
    cookieLabel(): string;
    keysList(): string;
    keysCourses(): string;
    keysEmptyCourse(): string;
    keysItems(): string;
    keysConfirm(): string;
    keysPrompt(): string;
    keysMessage(): string;
    downloading(p: { done: string; total: string; label: string }): string;
    errorsTitle(): string;
    success(p: { downloaded: string; skipped: string; dest: string }): string;
    farewell(): string;
    cancelled(): string;
  };

  readonly trace: {
    saved(p: { path: string }): string;
    savedHint(p: { path: string }): string;
  };

  readonly app: {
    errorPrefix(): string;
    usageHint(): string;
    unexpectedError(p: { detail: string }): string;
    done(p: { pages: string; mib: string }): string;
  };

  readonly session: {
    cookieMissing(): string;
    cookieInvalidChars(): string;
    blockedOrigin(p: { origin: string }): string;
    tooManyRedirects(p: { path: string }): string;
    redirectWithoutLocation(p: { path: string }): string;
    postRedirect(p: { path: string }): string;
    invalidLocation(p: { path: string }): string;
    notFound(p: { path: string }): string;
    httpStatus(p: { status: string; path: string }): string;
    authFailed(p: { cookieNames: string }): string;
  };

  readonly platform: {
    notJson(p: { path: string }): string;
    sesskeyNotFound(p: { title: string }): string;
    invalidSessionKey(): string;
    serviceError(p: { code: string; detail: string }): string;
    unexpectedShape(p: { what: string; shape: string }): string;
    contentsUnavailable(p: { course: string; attempts: string }): string;
    resourceNotResolved(p: { name: string; detail: string }): string;
    scormLaunchNotFound(p: { name: string; detail: string }): string;
    scormEntryNotFound(p: { name: string; detail: string }): string;
    pageHints(p: { title: string; details: string }): string;
    extensionUnknown(p: { spec: string; known: string }): string;
  };

  readonly locator: {
    probingRevisions(p: { max: string }): string;
    explicitRevisionMissing(p: { path: string }): string;
    revisionsNotFound(p: { entry: string; id: string; max: string }): string;
  };

  readonly slides: {
    arrayMissing(p: { title: string }): string;
    arrayEmpty(): string;
    tooMany(p: { count: string; max: string }): string;
    badJson(p: { detail: string }): string;
    badSrc(p: { position: string }): string;
  };

  readonly jpeg: {
    noStartMarker(p: { slide: string }): string;
    unreadable(p: { slide: string }): string;
    badDimensions(p: { slide: string }): string;
    unsupportedComponents(p: { slide: string; components: string }): string;
  };

  readonly pdf: {
    noImages(): string;
  };

  readonly downloader: {
    slideLabel(p: { position: string }): string;
    retrying(p: { label: string; attempt: string; retries: string; reason: string }): string;
    unexpectedContentType(p: { contentType: string }): string;
    notJpeg(): string;
    invalidSrc(p: { src: string }): string;
    slideFailed(p: { position: string; title: string; detail: string }): string;
  };

  readonly convert: {
    located(p: { id: string; revision: string; title: string }): string;
    slidesFound(p: { count: string }): string;
    buildingPdf(): string;
  };

  readonly http: {
    networkFailure(p: { path: string; name: string; detail: string }): string;
    responseTooLarge(p: { path: string; max: string }): string;
  };

  readonly sink: {
    writeFailed(p: { target: string; detail: string }): string;
  };

  readonly logger: {
    warningPrefix(): string;
  };
}
