export interface JpegSpec {
  readonly width: number;
  readonly height: number;
  readonly components?: 1 | 3 | 4;
  readonly progressive?: boolean;
  /** Bytes que se insertan justo antes del marcador SOF (relleno, marcadores sin longitud…). */
  readonly beforeFrame?: readonly number[];
}

function u16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

/**
 * JPEG sintético: solo tiene la estructura de marcadores que el inspector necesita
 * (SOI, APP0, SOF, SOS, EOI). No se puede decodificar, pero sí incrustar en un PDF.
 */
export function makeJpeg(spec: JpegSpec): Uint8Array {
  const components = spec.components ?? 3;
  const sof = [
    0xff, spec.progressive ? 0xc2 : 0xc0,
    ...u16(8 + 3 * components),
    8, ...u16(spec.height), ...u16(spec.width), components,
    ...Array.from({ length: components }, (_, index) => [index + 1, 0x11, 0]).flat(),
  ];
  const app0 = [0xff, 0xe0, ...u16(16), 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sos = [0xff, 0xda, ...u16(8), 1, 1, 0, 0, 0x3f, 0, 0xde, 0xad, 0xbe, 0xef];
  return Uint8Array.from([0xff, 0xd8, ...app0, ...(spec.beforeFrame ?? []), ...sof, ...sos, 0xff, 0xd9]);
}
