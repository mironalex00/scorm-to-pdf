import { describe, it } from "node:test";
import { en } from "../../src/i18n/en.ts";
import assert from "node:assert/strict";
import { JpegInspector } from "../../src/pdf/JpegInspector.ts";
import { ScormFormatError } from "../../src/domain/errors.ts";
import { makeJpeg } from "../support/jpegFixtures.ts";

const inspector = new JpegInspector({ messages: en });

function assertRejected(bytes: Uint8Array, pattern: RegExp): void {
  assert.throws(
    () => inspector.inspect(bytes, 4),
    (error: unknown) => error instanceof ScormFormatError && pattern.test(error.message),
  );
}

describe("JpegInspector", () => {
  it("reads dimensions and RGB color space from a baseline JPEG", () => {
    assert.deepEqual(inspector.inspect(makeJpeg({ width: 1920, height: 1080 }), 1), {
      width: 1920,
      height: 1080,
      colorSpace: "/DeviceRGB",
    });
  });

  it("recognizes a grayscale JPEG", () => {
    assert.equal(inspector.inspect(makeJpeg({ width: 10, height: 20, components: 1 }), 1).colorSpace, "/DeviceGray");
  });

  it("accepts a progressive JPEG", () => {
    const info = inspector.inspect(makeJpeg({ width: 640, height: 360, progressive: true }), 1);
    assert.deepEqual([info.width, info.height], [640, 360]);
  });

  it("skips fill bytes and standalone markers before the frame", () => {
    const bytes = makeJpeg({ width: 30, height: 40, beforeFrame: [0xff, 0xff, 0xff, 0xd0, 0xff, 0x01, 0xff, 0xd8] });
    const info = inspector.inspect(bytes, 1);
    assert.deepEqual([info.width, info.height], [30, 40]);
  });

  it("skips stray bytes between segments", () => {
    const info = inspector.inspect(makeJpeg({ width: 11, height: 22, beforeFrame: [0x00, 0x11, 0x22] }), 1);
    assert.deepEqual([info.width, info.height], [11, 22]);
  });

  it("rejects a CMYK JPEG and reports the slide number", () => {
    assertRejected(makeJpeg({ width: 5, height: 5, components: 4 }), /Slide 4.*4 JPEG components/);
  });

  it("rejects zero dimensions", () => {
    assertRejected(makeJpeg({ width: 0, height: 5 }), /Invalid JPEG dimensions.*slide 4/);
    assertRejected(makeJpeg({ width: 5, height: 0 }), /Invalid JPEG dimensions/);
  });

  it("rejects data without a start-of-image marker", () => {
    assertRejected(Uint8Array.from([0x3c, 0x68, 0x74, 0x6d, 0x6c]), /SOI/);
  });

  const unreadable: Array<[string, number[]]> = [
    ["start-of-image marker only", [0xff, 0xd8]],
    ["fill byte with no following marker", [0xff, 0xd8, 0xff]],
    ["truncated segment length", [0xff, 0xd8, 0xff, 0xe0, 0x00]],
    ["segment length below two bytes", [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0x00]],
    ["segment beyond the end of the file", [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x20, 0x00]],
    ["short frame header", [0xff, 0xd8, 0xff, 0xc0, 0x00, 0x05, 0x08, 0x00, 0x01]],
    ["start of scan before a frame header", [0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]],
  ];
  for (const [name, bytes] of unreadable) {
    it(`rejects unreadable JPEG data (${name})`, () => {
      assertRejected(Uint8Array.from(bytes), /Could not read JPEG dimensions.*slide 4/);
    });
  }
});
