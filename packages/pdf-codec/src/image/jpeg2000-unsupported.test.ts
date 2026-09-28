import { describe, expect, it } from "vitest";
import { Jpeg2000UnsupportedError } from "./jpeg2000-errors";
import { decodeJpeg2000 } from "./jpeg2000";
import {
  JPEG2000_FIXTURES,
  jpeg2000FixtureBytes,
} from "../test-support/jpeg2000";

// undecodableReason's refusal guards, each driven by byte surgery on a real fixture codestream rather than a hand-built stream: the "tiny" fixture is SOC/SIZ/COD/QCD/TLM-less minimal, and its COD marker sits at a fixed early offset, so each unsupported feature is patched in with one byte and the refusal must name exactly that feature.
function tinyFixture(): Uint8Array<ArrayBuffer> {
  const fixture = JPEG2000_FIXTURES.find(
    (candidate) => candidate.name === "tiny",
  );
  if (fixture === undefined) {
    throw new Error("the tiny fixture is absent from the vendored set");
  }
  return jpeg2000FixtureBytes(fixture.codestream);
}

describe("decodeJpeg2000: unsupported features are named, not mis-decoded", () => {
  it("refuses the code-block style's arithmetic coding bypass bit", () => {
    const stream = new Uint8Array(tinyFixture());
    // The COD marker's code-block style byte: the marker sits at byte 45 of this fixture, its style field at 57.
    stream[57] = 0x01;
    expect(() => decodeJpeg2000(stream)).toThrow(Jpeg2000UnsupportedError);
    expect(() => decodeJpeg2000(stream)).toThrow(/bypass/);
  });

  it("refuses the code-block style's terminate-on-every-pass bit", () => {
    const stream = new Uint8Array(tinyFixture());
    stream[57] = 0x04;
    expect(() => decodeJpeg2000(stream)).toThrow(
      /terminates the arithmetic coder/,
    );
  });

  it("still decodes the unpatched fixture, proving the offsets above are the style byte's own", () => {
    const image = decodeJpeg2000(tinyFixture());
    expect(image.width).toBe(5);
  });
});
