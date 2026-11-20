import type { Messages } from "./Messages.ts";

/** Catálogo en español: idioma por defecto y única traducción actual. */
export const es: Messages = {
  locale: "es",

  common: {
    untitled: () => "sin título",
    defaultFileName: () => "archivo",
  },

  options: {
    out: "Ruta del PDF. Por defecto se deduce del título del curso.",
    "out-dir": "Carpeta del PDF con nombre automático (por defecto: la actual).",
    concurrency: "Descargas en paralelo, de 1 a 32 (por defecto: 6).",
    "base-url": "Raíz de Moodle; selecciona la extensión por su host.",
    entry: "Documento de entrada del paquete (por defecto: index.html).",
    revision: "Revisión de la URL del contenido. Por defecto se detecta sola.",
    platform: "Extensión (ro.utcluj.kb) o URL de Moodle. Por defecto: ro.utcluj.kb.",
    lang: "Idioma de los mensajes (por defecto: el del sistema, o es).",
    trace: "Guarda una traza detallada con capturas redactadas de las respuestas.",
    "trace-dir": "Carpeta de la traza (por defecto: scorm-trace-<id>).",
    json: "Salida en JSON, para usar desde otros programas.",
    week: "Semanas a descargar, separadas por comas (p. ej. 1,3).",
    item: "Ids de los contenidos a descargar, separados por comas.",
    all: "Descarga todo el contenido del curso.",
    dest: "Carpeta de destino (por defecto: la actual).",
    quiet: "No mostrar el progreso.",
    help: "Mostrar esta ayuda.",
    version: "Mostrar la versión.",
  },

  help: {
    values: { file: "archivo", folder: "carpeta", path: "ruta", list: "lista", number: "n", url: "url", code: "código", platform: "id|url" },
    intro: (p) => [
      `Uso: ${p.program} [orden] [opciones]`,
      "",
      "Descarga el material de tus cursos de Moodle, ordenado por semanas. Sin argumentos,",
      "en una terminal interactiva, abre el selector.",
      "",
    ],
    commandsHeading: () => "Órdenes:",
    commandLines: (p) => [
      `  ${p.program}                       Selector interactivo (terminal)`,
      `  ${p.program} <id | URL>            Convierte un SCORM de diapositivas en PDF`,
      `  ${p.program} courses               Lista tus cursos`,
      `  ${p.program} items <curso>         Lista las semanas y los contenidos de un curso`,
      `  ${p.program} get <curso>           Descarga contenidos de un curso`,
      `  ${p.program} diagnose              Comprueba cada paso contra tu Moodle y guarda una traza`,
    ],
    globalHeading: () => "Opciones generales:",
    scormHeading: () => "Con <id | URL>:",
    listHeading: () => "Con courses e items:",
    getHeading: () => "Con get (usa --all o elige con --week / --item):",
    environment: () => [
      "Entorno:",
      "  MOODLE_COOKIE    Cookie de sesión de Moodle (obligatoria). Acepta el valor de la",
      "                   cabecera Cookie, «nombre=valor» o solo el valor de MoodleSession.",
      "  MOODLE_BASE_URL  Raíz de Moodle; --base-url tiene prioridad.",
      "  SCORM_PLATFORM   Equivale a --platform.",
      "  SCORM_LANG       Equivale a --lang.",
      "  SCORM_TRACE      Con valor 1, equivale a --trace.",
    ],
    exitCodes: () => [
      "Códigos de salida:",
      "  0  Éxito",
      "  1  Error de red, de formato, de disco o descargas fallidas",
      "  2  Uso incorrecto",
      "  3  Sesión de Moodle no válida",
    ],
    examples: (p) => [
      "Ejemplos:",
      `  ${p.program}`,
      `  ${p.program} 10067`,
      `  ${p.program} courses`,
      `  ${p.program} get algoritmi --week 1,3 --dest material`,
      `  ${p.program} https://kb.cunbm.utcluj.ro/pluginfile.php/10067/mod_scorm/content/3/index.html`,
    ],
  },

  cli: {
    unsupportedLocale: (p) => `Idioma no soportado: «${p.locale}». Disponibles: ${p.supported}.`,
    tooManyTargets: () => "Solo se admite un ID o una URL por ejecución.",
    notIdNorUrl: (p) => `«${p.raw}» no es ni un ID numérico ni una URL de pluginfile.php.`,
    badPluginfileUrl: (p) =>
      `La URL debe tener la forma …/pluginfile.php/<id>/mod_scorm/content/<n>/<archivo>: «${p.raw}».`,
    integerRange: (p) => `${p.label} debe ser un entero entre ${p.min} y ${p.max} (recibido «${p.raw}»).`,
    scormIdLabel: () => "El ID del SCORM",
    entryLabelUrl: () => "La entrada de la URL",
    unsafeEntry: (p) =>
      `${p.label} debe ser una ruta relativa dentro del paquete, sin '..', '//', '\\', '?' ni '#': «${p.raw}».`,
    baseUrlInvalid: (p) => `URL base no válida en ${p.source}: «${p.raw}».`,
    baseUrlInsecure: (p) =>
      `La URL base de ${p.source} debe usar https (http solo en localhost, para pruebas): «${p.raw}».`,
    sourceUrlGiven: () => "la URL indicada",
    outAndOutDir: () => "--out y --out-dir no se pueden usar a la vez.",
    unknownOption: (p) => `Opción desconocida: ${p.raw}.${p.suggestion}`,
    didYouMean: (p) => ` ¿Quisiste decir --${p.name}?`,
    optionRepeated: (p) => `La opción --${p.name} se indicó más de una vez.`,
    optionNeedsValue: (p) => `La opción --${p.name} requiere un valor.`,
    optionNoValue: (p) => `La opción --${p.name} no admite un valor.`,
    missingCourse: (p) => `Falta el curso: ${p.command} necesita su id o parte de su nombre.`,
    unexpectedArguments: (p) => `La orden ${p.command} no admite argumentos.`,
    listInvalid: (p) => `--${p.name} debe ser una lista de números enteros separados por comas (recibido «${p.raw}»).`,
    allConflicts: () => "--all no se puede combinar con --week ni --item.",
    nothingSelected: () => "No hay nada que descargar: indica --all, --week o --item.",
    tuiNeedsTerminal: () =>
      "El selector interactivo necesita una terminal. Usa una orden (courses, items, get) o un ID de SCORM; --help muestra el uso.",
    courseNotFound: (p) => `No se encontró ningún curso que coincida con «${p.query}».`,
    courseAmbiguous: (p) => `«${p.query}» coincide con varios cursos; usa su id: ${p.matches}`,
  },

  commands: {
    weekHeading: (p) => (p.title === "" ? `Semana ${p.number}` : `Semana ${p.number} — ${p.title}`),
    emptyWeek: () => "  (sin contenido descargable)",
    itemLine: (p) => `  [${p.kind}] ${p.id}  ${p.name}`,
    kindResource: () => "recurso",
    kindScorm: () => "scorm",
    skipped: (p) => `Omitido (ya existe): ${p.path}`,
    failed: (p) => `Fallo en «${p.name}»: ${p.detail}`,
    summary: (p) => `Descargados: ${p.downloaded} · Omitidos: ${p.skipped} · Fallidos: ${p.failed}`,
    abortedBySession: () => "La sesión caducó: se detuvo la descarga de lo que faltaba.",
    diagnoseOk: (p) => `✓ ${p.step}: ${p.detail}`,
    diagnoseFailed: (p) => `✗ ${p.step}: ${p.detail}`,
    stepCourses: () => "Lista de cursos",
    stepContents: () => "Contenido de un curso",
    stepResource: () => "Resolver un recurso",
    stepScorm: () => "Resolver un SCORM",
    detailCourses: (p) => `${p.count} cursos`,
    detailContents: (p) => `${p.sections} secciones, ${p.items} contenidos`,
    detailResource: (p) => `«${p.name}» (${p.bytes} bytes)`,
    detailScorm: (p) => `«${p.name}»`,
    detailNothingToTry: () => "no hay ninguno que probar",
    diagnoseTrace: (p) => `Traza completa en: ${p.path}`,
  },

  tui: {
    loadingCourses: () => "Cargando cursos…",
    loadingContents: (p) => `Cargando el contenido de «${p.course}»…`,
    coursesTitle: () => "Tus cursos (orden alfabético)",
    noCourses: () => "No hay cursos para mostrar.",
    itemsTitle: (p) => `«${p.course}» — elige qué descargar`,
    noItems: () => "Este curso no tiene contenido descargable.",
    nothingMarked: () => "Marca al menos un contenido con la barra espaciadora.",
    selectedCount: (p) => `${p.count} seleccionados`,
    confirmTitle: (p) => `Confirmar la descarga de ${p.count} contenidos`,
    destinationTitle: () => "¿Dónde guardar los archivos?",
    destinationCurrent: (p) => `En la carpeta actual (${p.path})`,
    destinationOther: () => "Escribir otra ruta…",
    pathTitle: () => "Carpeta de destino",
    pathLabel: () => "Ruta:",
    cookieTitle: () => "Falta la cookie de sesión de Moodle",
    cookieLines: () => [
      "Abre Moodle en tu navegador con la sesión iniciada y, en las herramientas de desarrollo,",
      "pestaña Red, copia el valor de la cabecera Cookie de cualquier petición. No se guarda.",
    ],
    cookieLabel: () => "Cookie:",
    keysList: () => "↑↓ mover · Enter elegir · Esc salir",
    keysCourses: () => "↑↓ mover · Espacio marcar · A todo · Enter continuar · Esc salir",
    keysEmptyCourse: () => "Enter continuar · Esc volver",
    keysItems: () => "↑↓ mover · Espacio marcar · a semana · A todo · Enter continuar · Esc volver",
    keysConfirm: () => "↑↓ desplazar · Enter descargar · Esc volver",
    keysPrompt: () => "Enter aceptar · Esc volver",
    keysMessage: () => "Pulsa una tecla para salir",
    downloading: (p) => `Descargando ${p.done}/${p.total}: ${p.label}`,
    errorsTitle: () => "Hubo errores en la descarga",
    success: (p) => `✓ Descarga completada: ${p.downloaded} archivos nuevos, ${p.skipped} ya existían — ${p.dest}`,
    farewell: () => "Mulțumesc!",
    cancelled: () => "Cancelado.",
  },

  trace: {
    saved: (p) => `Traza guardada en ${p.path}`,
    savedHint: (p) => `Traza guardada en ${p.path}. Repite con --trace para capturar también las respuestas (redactadas).`,
  },

  app: {
    errorPrefix: () => "ERROR:",
    usageHint: () => "Ejecuta con --help para ver el uso.",
    unexpectedError: (p) => `ERROR inesperado: ${p.detail}`,
    done: (p) => `Listo: ${p.pages} páginas, ${p.mib} MiB`,
  },

  session: {
    cookieMissing: () => "Falta MOODLE_COOKIE: define la cookie de sesión de Moodle (variable de entorno o archivo .env).",
    cookieInvalidChars: () => "MOODLE_COOKIE contiene caracteres no válidos (saltos de línea o no ASCII).",
    blockedOrigin: (p) =>
      `Se bloqueó la petición a otro dominio (${p.origin}) para no enviarle la cookie de Moodle. ` +
      "Si es un proveedor de inicio de sesión, la sesión de Moodle no es válida.",
    tooManyRedirects: (p) => `Demasiadas redirecciones al pedir ${p.path}.`,
    redirectWithoutLocation: (p) => `Redirección sin cabecera Location en ${p.path}.`,
    postRedirect: (p) => `Redirección inesperada en una petición POST a ${p.path}.`,
    invalidLocation: (p) => `Location no válido en la redirección de ${p.path}.`,
    notFound: (p) => `No existe en el servidor: ${p.path}`,
    httpStatus: (p) => `HTTP ${p.status} en ${p.path}.`,
    authFailed: (p) =>
      "Moodle no reconoce la sesión (devuelve el inicio de sesión).\n" +
      `  Cookies enviadas (solo nombres): ${p.cookieNames}\n` +
      "  Causas habituales: la sesión caducó o se rotó (cerrar sesión o volver a entrar la invalida);\n" +
      "  el nombre de la cookie lleva un sufijo (p. ej. MoodleSessionkb); o el valor está truncado.\n" +
      "  Cómo obtenerla: DevTools → Network → recarga el SCORM → petición index.html → Request Headers → Cookie.",
  },

  platform: {
    notJson: (p) => `La respuesta de ${p.path} no es JSON.`,
    sesskeyNotFound: (p) =>
      `No se encontró el sesskey en la página de cursos (título: «${p.title}»). ` +
      "Comprueba que la cookie corresponda a una sesión abierta.",
    invalidSessionKey: () => "Moodle rechazó la clave de sesión (sesskey): vuelve a obtener la cookie.",
    serviceError: (p) => `Moodle respondió con un error (${p.code}): ${p.detail}`,
    unexpectedShape: (p) => `Respuesta inesperada de Moodle (${p.what}). Forma recibida: ${p.shape}`,
    contentsUnavailable: (p) => `No se pudo leer el contenido del curso «${p.course}». Intentos: ${p.attempts}`,
    resourceNotResolved: (p) => `No se pudo localizar el archivo del recurso «${p.name}». ${p.detail}`,
    scormLaunchNotFound: (p) => `No se encontraron los datos de lanzamiento del SCORM «${p.name}». ${p.detail}`,
    scormEntryNotFound: (p) => `No se encontró el documento de entrada del SCORM «${p.name}». ${p.detail}`,
    pageHints: (p) => `Página recibida: «${p.title}». ${p.details}`,
    extensionUnknown: (p) => `Plataforma desconocida: «${p.spec}». Disponibles: ${p.known}, o una URL de Moodle.`,
  },

  locator: {
    probingRevisions: (p) => `La revisión 1 no existe; buscando la correcta entre 0 y ${p.max}…`,
    explicitRevisionMissing: (p) =>
      `No existe ${p.path}. Comprueba el ID o prueba sin --revision para que se detecte sola.`,
    revisionsNotFound: (p) =>
      `No se encontró ${p.entry} para el SCORM ${p.id} (revisiones 0..${p.max}). ` +
      "Comprueba el ID y que la cookie pertenezca a un usuario con acceso al curso.",
  },

  slides: {
    arrayMissing: (p) =>
      `No se encontró «const SLIDES = [...]» en el documento (título de la página: «${p.title}»). ` +
      "Si es una página de Moodle, revisa la sesión; si no, este SCORM usa otro formato.",
    arrayEmpty: () => "El array SLIDES está vacío.",
    tooMany: (p) => `El SCORM declara ${p.count} diapositivas; el máximo permitido es ${p.max}.`,
    badJson: (p) => `No se pudo interpretar el array SLIDES: ${p.detail}`,
    badSrc: (p) => `La diapositiva ${p.position} no tiene una propiedad src válida.`,
  },

  jpeg: {
    noStartMarker: (p) => `La diapositiva ${p.slide} no comienza con un marcador JPEG SOI.`,
    unreadable: (p) => `No se pudieron leer las dimensiones JPEG de la diapositiva ${p.slide}.`,
    badDimensions: (p) => `Dimensiones JPEG inválidas en la diapositiva ${p.slide}.`,
    unsupportedComponents: (p) =>
      `La diapositiva ${p.slide} usa ${p.components} componentes JPEG; solo se admite escala de grises o RGB.`,
  },

  pdf: {
    noImages: () => "No hay imágenes para incluir en el PDF.",
  },

  downloader: {
    slideLabel: (p) => `diapositiva ${p.position}`,
    retrying: (p) => `${p.label}: reintento ${p.attempt}/${p.retries} (${p.reason})`,
    unexpectedContentType: (p) => `Content-Type inesperado (${p.contentType}); ¿ha caducado la sesión?`,
    notJpeg: () => "El recurso recibido no es un JPEG válido.",
    invalidSrc: (p) => `src no válido: «${p.src}»`,
    slideFailed: (p) => `Diapositiva ${p.position}${p.title}: ${p.detail}`,
  },

  convert: {
    located: (p) => `SCORM ${p.id} localizado (revisión ${p.revision}): ${p.title}`,
    slidesFound: (p) => `${p.count} diapositivas; descargando…`,
    buildingPdf: () => "Generando el PDF…",
  },

  http: {
    networkFailure: (p) => `Fallo de red al pedir ${p.path}: ${p.name}: ${p.detail}`,
    responseTooLarge: (p) => `La respuesta de ${p.path} supera el límite de ${p.max} bytes.`,
  },

  sink: {
    writeFailed: (p) => `No se pudo escribir ${p.target}: ${p.detail}`,
  },

  logger: {
    warningPrefix: () => "Aviso:",
  },
};
