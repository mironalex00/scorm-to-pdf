# Motor ASCII

La orden ASCII de scorm-to-pdf convierte JPG/JPEG, PNG, WebP estático, GIF animado, MP4 y WebM. Ajusta la forma y el tono de cada celda con los 95 glifos imprimibles. Admite color ANSI truecolor de primer plano y fondo.

## Uso

~~~sh
npm ci
node src/main.ts ascii --help
node src/main.ts ascii src/extensions/ascii/content/bear_hoop.png --invert -w 48
node src/main.ts ascii src/extensions/ascii/content/wink_cat.gif --loop --color --fps 12
node src/main.ts ascii video.mp4 -o video-ascii.webm --bg --cols 100
~~~

También puedes usar Bun y bun install. ASCII admite archivos y URLs HTTP(S) sin una sesión Moodle. Sin destino, las animaciones se reproducen en la terminal y Ctrl+C restaura la pantalla. Con stdout redirigido se escribe el primer cuadro. La ruta anterior src/extensions/ascii/main.ts llama al mismo CLI con la orden ascii.

| Salida | Comportamiento |
| --- | --- |
| .txt, .ansi, .png | Exporta el primer cuadro. |
| .json, .html | Exporta la animación con su frecuencia de cuadros. El valor por defecto de --max-frames es 600. |
| .gif, .mp4, .webm, .mov, .mkv, .avi | Rasteriza los glifos. El vídeo conserva la primera pista de audio si existe, salvo con --mute. |

## Preparación y compilación

El conversor usa los [archivos de FFmpeg y FFprobe 9.0.2 de Martin Riedl](https://ffmpeg.martin-riedl.de/) para macOS y Linux, x64 y arm64. La primera conversión obtiene los dos ZIP de la versión fijada y comprueba su SHA-256. Se guardan comprimidos en .ascii-cache dentro del directorio actual. SCORM_ASCII_CACHE permite usar una carpeta común desde distintos directorios.

Cada operación extrae el par verificado en un directorio temporal privado y emplea rutas absolutas. Se elimina al terminar, al fallar y tras SIGHUP, SIGINT o SIGTERM. Una terminación forzosa del sistema puede dejar residuos en el directorio temporal. Las siguientes conversiones locales usan el par comprimido en caché.

Puedes preparar los ZIP antes de compilar o ejecutar sin conexión:

~~~sh
npm run ascii:prepare
bun build --compile src/main.ts --outfile dist/scorm-to-pdf
~~~

El programa compilado incluye el descompresor y los cuadros de la TUI. Puede preparar su propia caché con ascii --prepare o usar una preparada mediante SCORM_ASCII_CACHE.

## Cuadros para la TUI y TypeScript

La despedida, el error de descarga y el error general reproducen los cuadros ASCII generados a partir de bear_hoop.png, hammer_point.png y startled_boy.png, respectivamente. El generador usa los mismos glifos que la orden ascii y aplica movimientos limitados al aro, al martillo o a los brazos. Los cuadros se incluyen con la TUI y se regeneran con npm run ascii:art.

~~~ts
import { renderAsciiClip, fitAsciiFrame } from "./src/extensions/ascii/index.ts";

const clip = await renderAsciiClip("wink_cat.gif", { cols: 40, fps: 12 });
const firstFrame = fitAsciiFrame(clip.frames[0]!, 79, 20);
~~~

La salida JSON usa cols, rows, fps y frames. Cada cuadro de frames contiene líneas ASCII sin secuencias de control. AsciiEngine admite cuadros RGB24 en memoria. openAsciiMedia permite leer cuadros con un iterador asíncrono y liberar su directorio temporal al cerrar el iterador.

Las pruebas multimedia usan los ZIP preparados. Después de npm run ascii:prepare, SCORM_ASCII_TEST=1 npm test exige ejecutarlas y detecta un paquete ausente.
