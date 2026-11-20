# Motor ASCII

Convierte JPG/JPEG, PNG, WebP, GIF, MP4 y WebM a texto ASCII. El motor compara cada celda con los 95 glifos imprimibles de una fuente 5×7 y ajusta forma y tono. Puede usar color ANSI truecolor de primer plano y de fondo.

La conversión requiere [FFmpeg y FFprobe](https://ffmpeg.org/download.html), disponibles en PATH o indicados mediante FFMPEG y FFPROBE. Usar el motor y reproducir cuadros ya generados desde TypeScript no requiere paquetes de npm. La disponibilidad de los códecs depende de la compilación de FFmpeg. Se ha comprobado WebP estático y GIF animado.

## Desde la terminal

~~~sh
node src/extensions/ascii/main.ts src/extensions/ascii/content/bear_hoop.png --invert -w 48
node src/extensions/ascii/main.ts src/extensions/ascii/content/wink_cat.gif --loop --color --fps 12
node src/extensions/ascii/main.ts src/extensions/ascii/content/scared_cat.gif -o scared.json --cols 40 --fps 12
node src/extensions/ascii/main.ts video.mp4 -o video-ascii.webm --bg --cols 100
~~~

También puedes ejecutar esos comandos con Bun. Sin destino, las animaciones se reproducen en la terminal y Ctrl+C restaura la pantalla. Cuando rediriges stdout, se escribe el primer cuadro. La conversión admite archivos y URLs HTTP(S).

| Salida | Comportamiento |
| --- | --- |
| .txt, .ansi, .png | Exporta el primer cuadro. |
| .json, .html | Exporta la animación con su frecuencia de cuadros. Se pueden limitar los cuadros con --max-frames. |
| .gif, .mp4, .webm, .mov, .mkv, .avi | Rasteriza los glifos y exporta la animación. El vídeo conserva la primera pista de audio si existe, salvo con --mute. |

La salida JSON contiene cols, rows, fps y frames. Cada cuadro de frames es un array de líneas ASCII sin secuencias de control. Los cuadros se pueden renderizar en una pantalla propia, con fitAsciiFrame para centrarlos o recortarlos.

## Desde TypeScript

~~~ts
import { renderAsciiClip, fitAsciiFrame } from "./src/extensions/ascii/index.ts";

const clip = await renderAsciiClip("wink_cat.gif", { cols: 40, fps: 12 });
const firstFrame = fitAsciiFrame(clip.frames[0]!, 79, 20);
~~~

AsciiEngine también admite cuadros RGB24 en memoria. openAsciiMedia permite recorrer cuadros con un iterador asíncrono para procesar vídeos sin cargar todos los píxeles en memoria a la vez.

Los tres GIF y las tres referencias PNG de content se usan en pruebas de integración. Las pruebas de conversión real requieren FFmpeg y FFprobe. El ajuste de glifos y la colocación en pantalla se prueban de forma independiente.
