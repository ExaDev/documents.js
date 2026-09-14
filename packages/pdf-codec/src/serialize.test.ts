import { describe, expect, it } from "vitest";
import {
  pdfArray,
  pdfBool,
  pdfDict,
  pdfHexString,
  pdfName,
  pdfNull,
  pdfNum,
  pdfRef,
  pdfStream,
} from "./objects";
import { formatNumber, serializeObject } from "./serialize";

function text(bytes: Uint8Array<ArrayBuffer>): string {
  return new TextDecoder().decode(bytes);
}

describe("formatNumber", () => {
  it("formats whole and fractional numbers without exponential notation", () => {
    expect(formatNumber(612)).toBe("612");
    expect(formatNumber(0.5)).toBe("0.5");
    expect(formatNumber(1 / 3)).toBe("0.3333");
  });

  it("never produces exponential notation for a very small number", () => {
    expect(formatNumber(0.00000001)).toBe("0");
    expect(formatNumber(0.00000001)).not.toContain("e");
  });

  it("rounds to 0 below NUMBER_EPSILON even where toFixed alone would round up to a nonzero string", () => {
    // 0.00006 is below the 0.0001 epsilon guard, but toFixed(4) rounds IT UP to "0.0001" on its own (nearest-4dp rounding kicks in past 0.00005) -- so this is the one magnitude range where skipping the guard entirely would change the answer, unlike 0.00000001 above.
    expect(formatNumber(0.00006)).toBe("0");
  });

  it("takes the normal formatting path at exactly NUMBER_EPSILON, not the below-epsilon shortcut", () => {
    expect(formatNumber(0.0001)).toBe("0.0001");
  });

  it("normalises -0 to 0", () => {
    expect(formatNumber(-0)).toBe("0");
  });

  it("strips trailing zeros and a bare trailing decimal point", () => {
    expect(formatNumber(1.5)).toBe("1.5");
    expect(formatNumber(1.0)).toBe("1");
  });
});

describe("writeObject / serializeObject", () => {
  it("serializes primitives", () => {
    expect(text(serializeObject(pdfNull()))).toBe("null");
    expect(text(serializeObject(pdfBool(true)))).toBe("true");
    expect(text(serializeObject(pdfBool(false)))).toBe("false");
    expect(text(serializeObject(pdfNum(12.5)))).toBe("12.5");
    expect(text(serializeObject(pdfName("Catalog")))).toBe("/Catalog");
    expect(text(serializeObject(pdfRef(3, 0)))).toBe("3 0 R");
  });

  it("always serializes strings as hex, regardless of the hex flag", () => {
    const bytes = new TextEncoder().encode("Hi");
    expect(text(serializeObject(pdfHexString(bytes)))).toBe("<4869>");
  });

  it("escapes a name containing a delimiter or non-printable character", () => {
    expect(text(serializeObject(pdfName("A B")))).toBe("/A#20B");
  });

  it("leaves the two boundary safe characters, '!' (0x21) and '~' (0x7e), unescaped", () => {
    expect(text(serializeObject(pdfName("!~")))).toBe("/!~");
  });

  it("escapes DEL (0x7f), one past the safe range's own upper boundary", () => {
    expect(text(serializeObject(pdfName("\x7f")))).toBe("/#7f");
  });

  it("zero-pads a single-hex-digit escape to two digits", () => {
    // \x01 escapes to "01", not "1" -- padStart(2, "0") actually mattering, unlike every other escape in this file's tests, whose codes are already two hex digits wide.
    expect(text(serializeObject(pdfName("\x01")))).toBe("/#01");
  });

  it("serializes an array of mixed types space-separated", () => {
    expect(
      text(serializeObject(pdfArray([pdfNum(1), pdfName("X"), pdfBool(true)]))),
    ).toBe("[1 /X true]");
  });

  it("serializes a dictionary", () => {
    const dict = pdfDict({ Type: pdfName("Catalog"), Count: pdfNum(3) });
    expect(text(serializeObject(dict))).toBe("<</Type /Catalog /Count 3 >>");
  });

  it("serializes a stream, deriving /Length from the actual byte count", () => {
    const raw = new TextEncoder().encode("BT /F1 12 Tf ET");
    const stream = pdfStream(pdfDict({ Length: pdfNum(999) }), raw);
    const out = text(serializeObject(stream));
    expect(out).toContain(`/Length ${raw.length}`);
    expect(out).not.toContain("999");
    expect(out).toContain("\nstream\nBT /F1 12 Tf ET\nendstream");
  });
});
