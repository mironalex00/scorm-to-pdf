# scorm-to-pdf

Descarga el material de tus cursos de Moodle ordenado por semanas. Los archivos directos se guardan tal cual; los SCORM de diapositivas se convierten a PDF. La descarga de Moodle y sus animaciones funcionan con Node o Bun.

```sh
export MOODLE_COOKIE='...'      # o en un archivo .env (Bun lo carga solo); si falta, el selector la pide
bun src/main.ts                 # selector interactivo
```

Sin Bun: `node src/main.ts` (Node 22.18 o posterior; en 22.6–22.17 añade `--experimental-strip-types`).

## Órdenes

| Orden | Qué hace |
| --- | --- |
| *(ninguna, en una terminal)* | Selector de uno o varios cursos → contenidos de cada curso → confirmación → destino |
| `courses [--json]` | Lista tus cursos |
| `items <curso> [--json]` | Semanas y contenidos de un curso (`<curso>` es el id o parte del nombre) |
| `get <curso> --all \| --week 1,3 \| --item 501,512 [--dest carpeta]` | Descarga una selección |
| `<id \| URL>` | Convierte un SCORM de diapositivas en PDF (la orden original, intacta) |
| `diagnose` | Recorre la cadena completa contra tu Moodle y guarda una traza |
| `ascii <entrada>` | Convierte imágenes, GIF y vídeos a ASCII |

Opciones generales: `--platform`, `--base-url`, `--lang`, `-c/--concurrency`, `--trace`, `--trace-dir`, `-q`, `-h`, `-v`. `--help` muestra todo. Códigos de salida: `0` éxito, `1` error o descargas fallidas, `2` uso incorrecto, `3` sesión no válida, `130` cancelado.

**Selector:** `↑↓` mueve el cursor, `Espacio` marca cursos o contenidos, `A` marca todo y `Enter` continúa. Si no has marcado ningún curso, `Enter` abre el que tiene el cursor. En los contenidos, `a` marca una sección. `Esc` vuelve un paso y conserva las marcas de cada curso durante la sesión. Un curso con materiales elegidos aparece marcado y la confirmación reúne los materiales de todos los cursos. Desmarcar un curso en la lista quita sus materiales de la selección. `Ctrl+C` cancela. Al completar la descarga, una pantalla de despedida muestra un agradecimiento en rumano y un oso animado con un aro antes de devolver el control a la terminal.

**Destino:** el selector guarda en `<destino>/content/<curso>/<título de sección>/<nombre del material>/<archivo>`, incluso si eliges un solo curso. `get` guarda en `<destino>/<título de sección>/<archivo>`. Cuando una sección carece de título, se usa su número. Si dos nombres de carpeta coinciden después de quitar caracteres incompatibles, se distinguen con sufijos como `(2)`. Si el destino ya contiene un archivo, se omite.

## Motor ASCII

Ejecuta `node src/main.ts ascii foto.png --invert -w 48` o consulta `ascii --help`. La [extensión ASCII](src/extensions/ascii/README.md) admite texto, reproducción en terminal, HTML, JSON, imágenes y vídeo. Prepara FFmpeg y FFprobe en un directorio temporal por ejecución. La TUI reproduce los cuadros generados desde los PNG de referencia con ese mismo motor.

## Cuando algo falla (trazabilidad)

La herramienta se diseñó para depurarse sin acceso a tu Moodle. Cada operación deja un evento con **cuándo** (marca de tiempo y duración), **dónde** (ámbito y contenido afectado) y **cómo** (cadena de causas y la forma de la respuesta recibida, sin sus valores).

1. `bun src/main.ts diagnose` prueba cursos, contenido, un recurso y un SCORM, marca cada paso y guarda la traza.
2. Con cualquier orden, `--trace` guarda la traza completa y capturas **redactadas** de las páginas clave (`scorm-trace-<id>/trace.jsonl` y `snapshots/`).
3. Sin `--trace`, un fallo real deja igualmente los últimos eventos y te dice dónde.

Antes de enviar una traza, revísala: se eliminan la cookie, el sesskey, tokens y correos, pero los nombres de curso y de persona que salgan en las páginas no se pueden detectar de forma fiable.

## Plataformas y extensiones

Todo lo que se usa (`my/courses.php`, `lib/ajax/service.php`, el índice del curso, `mod/resource`, `mod/scorm`, `loadSCO.php`) es Moodle estándar. Por eso solo hay un adaptador (`src/platforms/moodle`) y cada **extensión de Moodle** es configuración, identificada con un nombre de paquete en dominio inverso y ubicada en la ruta equivalente: `ro.utcluj.kb` → `src/extensions/ro/utcluj/kb/`. El registro es una lista estática; nada se carga en tiempo de ejecución.

`--platform ro.utcluj.kb` elige una extensión; `--platform https://campus.example.org` o `--base-url` eligen por host y, si no hay extensión, usan Moodle estándar. `MOODLE_BASE_URL` sigue funcionando como alias. Equivalentes de entorno: `SCORM_PLATFORM`, `SCORM_LANG`, `SCORM_TRACE=1`.

## Idiomas

Todos los textos visibles viven en un catálogo tipado (`src/i18n/es.ts`, que implementa la interfaz `Messages`). Para añadir un idioma se crea otro archivo que implemente esa interfaz —el compilador rechaza un catálogo incompleto— y se registra en `CliApplication`. Se elige con `--lang`, `SCORM_LANG` o `LANG`.

## Memoria y secretos

El catálogo se guarda **comprimido (gzip) y solo en RAM**; cada curso se pide al entrar en él y se descomprime únicamente lo que se consulta. Nada se persiste. La cookie y el sesskey viven en valores que no se imprimen ni se serializan, y todo lo que se almacena o se traza pasa antes por el redactor.

## Estructura

| Carpeta | Contenido |
| --- | --- |
| `src/cli` | `CliParser` multiorden, `OptionCollector`, `HelpFormatter` (generada desde el catálogo) |
| `src/commands` | Una clase por orden |
| `src/application` | Servicios: `CatalogService`, `BatchDownloader`, `ItemDownloader`, `SlidesToPdf`, `FileNamer`, `NamePlanner`… y los puertos (`ports.ts`) |
| `src/platforms/moodle` | Adaptador de Moodle: lista de cursos, índice, recursos, SCORM |
| `src/extensions` | Extensiones por paquete y su registro |
| `src/tui` | Terminal real, pantallas puras y orquestación del selector |
| `src/tracing`, `src/store`, `src/html`, `src/i18n`, `src/pdf`, `src/infra` | Trazas, almacén comprimido, lector de HTML, idiomas, PDF y adaptadores |
| `src/composition`, `src/CliApplication.ts` | Raíz de composición: el único sitio que instancia clases concretas |

## Desarrollo

Usa `npm ci` o `bun install` para instalar las herramientas de desarrollo y el descompresor que usa `ascii`. `npm run ascii:prepare` prepara la caché de los códecs y `npm run ascii:art` regenera los cuadros de la TUI.

```sh
npm install
npm test               # node:test; también con `bun test`
npm run typecheck
npm run coverage       # exige 100 % de líneas, ramas y funciones
```

## Límites conocidos

- Las respuestas de Moodle se reconstruyeron a partir de lo observado en DevTools y de Moodle 4.x estándar, **sin acceso a la instalación real**: los fixtures de `test/fixtures` son sintéticos. Si algo no encaja, `diagnose` y `--trace` indican qué forma llegó.
- El selector se probó en Linux (Node y Bun, con un pseudo-terminal real). macOS debería comportarse igual; Windows no está verificado.
- Durante la descarga el selector no es interrumpible.
- Solo recursos y SCORM; solo SCORM de diapositivas en JPEG (gris o RGB); 25 MiB por imagen y 200 MiB por archivo.
