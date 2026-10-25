import { ScormFormatError } from "../domain/errors.ts";
import type { Messages } from "../i18n/Messages.ts";

export interface JpegInfo {
  readonly width: number;
  readonly height: number;
  readonly colorSpace: "/DeviceGray" | "/DeviceRGB";
}

const SOF_MARKERS: ReadonlySet<number> = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);
const START_OF_IMAGE = 0xd8;
const START_OF_SCAN = 0xda;
const TEMPORARY = 0x01;
const RESTART_FIRST = 0xd0;
const RESTART_LAST = 0xd7;

/** Lee las dimensiones y los componentes de un JPEG recorriendo sus marcadores. */
export class JpegInspector {
  private readonly messages: Messages;

  constructor(deps: { messages: Messages }) {
    this.messages = deps.messages;
  }

  inspect(jpeg: Uint8Array, slideNumber: number): JpegInfo {
    if (jpeg[0] !== 0xff || jpeg[1] !== START_OF_IMAGE) {
      throw new ScormFormatError(this.messages.jpeg.noStartMarker({ slide: String(slideNumber) }));
    }

    let offset = 2;
    while (offset < jpeg.length) {
      while (offset < jpeg.length && jpeg[offset] !== 0xff) offset += 1;
      while (offset < jpeg.length && jpeg[offset] === 0xff) offset += 1;
      if (offset >= jpeg.length) break;

      const marker = jpeg[offset]!;
      offset += 1;
      if (this.hasNoLength(marker)) continue;

      if (offset + 2 > jpeg.length) break;
      const segmentLength = this.readUint16(jpeg, offset);
      if (segmentLength < 2 || offset + segmentLength > jpeg.length) break;

      if (SOF_MARKERS.has(marker)) {
        if (segmentLength < 8) break;
        return this.readFrame(jpeg, offset, slideNumber);
      }
      if (marker === START_OF_SCAN) break;
      offset += segmentLength;
    }

    throw new ScormFormatError(this.messages.jpeg.unreadable({ slide: String(slideNumber) }));
  }

  private hasNoLength(marker: number): boolean {
    const isRestart = marker >= RESTART_FIRST && marker <= RESTART_LAST;
    return marker === START_OF_IMAGE || marker === 0xd9 || marker === TEMPORARY || isRestart;
  }

  private readFrame(jpeg: Uint8Array, offset: number, slideNumber: number): JpegInfo {
    const height = this.readUint16(jpeg, offset + 3);
    const width = this.readUint16(jpeg, offset + 5);
    const components = jpeg[offset + 7];

    if (!width || !height) {
      throw new ScormFormatError(this.messages.jpeg.badDimensions({ slide: String(slideNumber) }));
    }
    if (components !== 1 && components !== 3) {
      throw new ScormFormatError(
        this.messages.jpeg.unsupportedComponents({ slide: String(slideNumber), components: String(components) }),
      );
    }
    return { width, height, colorSpace: components === 1 ? "/DeviceGray" : "/DeviceRGB" };
  }

  private readUint16(bytes: Uint8Array, offset: number): number {
    return (bytes[offset]! << 8) | bytes[offset + 1]!;
  }
}
