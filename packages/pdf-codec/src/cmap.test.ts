import { describe, expect, it } from "vitest";
import type { PdfDiagnostic, PdfDiagnosticSink } from "./diagnostics";
import { parseToUnicodeCMap } from "./cmap";

function collectDiagnostics(): {
  sink: PdfDiagnosticSink;
  diagnostics: PdfDiagnostic[];
} {
  const diagnostics: PdfDiagnostic[] = [];
  return { sink: (d) => diagnostics.push(d), diagnostics };
}

function textBytes(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

describe("parseToUnicodeCMap: bfchar", () => {
  it("maps individual codes to their Unicode destination", () => {
    const { sink } = collectDiagnostics();
    const cmap = parseToUnicodeCMap(
      textBytes("1 beginbfchar\n<0003> <0041>\n<0004> <0042>\nendbfchar"),
      sink,
    );
    expect(cmap.lookup(3)).toBe("A");
    expect(cmap.lookup(4)).toBe("B");
    expect(cmap.lookup(5)).toBeUndefined();
  });

  it("decodes a multi-character (ligature) destination", () => {
    const { sink } = collectDiagnostics();
    // 'f','f','i' as three UTF-16BE code units.
    const cmap = parseToUnicodeCMap(
      textBytes("beginbfchar\n<0010> <00660066 0069>\nendbfchar"),
      sink,
    );
    expect(cmap.lookup(0x10)).toBe("ffi");
  });

  it("drops a trailing unpaired byte from an odd-length UTF-16BE destination rather than manufacturing an extra code unit", () => {
    const { sink } = collectDiagnostics();
    // <414243> is 3 raw bytes -- one complete UTF-16BE code unit (0x4142) plus a dangling 0x43 that forms no second pair.
    const cmap = parseToUnicodeCMap(
      textBytes("beginbfchar\n<0007> <414243>\nendbfchar"),
      sink,
    );
    expect(cmap.lookup(7)).toBe(String.fromCharCode(0x4142));
  });

  it("reports a diagnostic and stops cleanly when truncated before endbfchar", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const cmap = parseToUnicodeCMap(
      textBytes("beginbfchar\n<0003> <0041>"),
      sink,
    );
    expect(cmap.lookup(3)).toBe("A");
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "pdf/cmap-truncated",
        message: "bfchar section was truncated before endbfchar",
      }),
    ]);
  });

  it("reports a diagnostic and skips an entry whose destination isn't a hex string", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const cmap = parseToUnicodeCMap(
      textBytes("beginbfchar\n<0003> 42\n<0004> <0042>\nendbfchar"),
      sink,
    );
    expect(cmap.lookup(3)).toBeUndefined();
    expect(cmap.lookup(4)).toBe("B");
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "pdf/cmap-entry-invalid",
        message: "bfchar entry had no valid destination hex string",
      }),
    ]);
  });

  it("does not stop at a stray keyword that isn't endbfchar, and reports no diagnostic for a well-formed section", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const cmap = parseToUnicodeCMap(
      textBytes(
        "beginbfchar\n<0003> <0041>\nsomestrayword\n<0004> <0042>\nendbfchar",
      ),
      sink,
    );
    expect(cmap.lookup(3)).toBe("A");
    expect(cmap.lookup(4)).toBe("B");
    expect(diagnostics).toEqual([]);
  });
});

describe("parseToUnicodeCMap: bfrange", () => {
  it("maps a contiguous range via a single incrementing destination", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const cmap = parseToUnicodeCMap(
      textBytes("beginbfrange\n<0005> <0007> <0043>\nendbfrange"),
      sink,
    );
    expect(cmap.lookup(5)).toBe("C");
    expect(cmap.lookup(6)).toBe("D");
    expect(cmap.lookup(7)).toBe("E");
    expect(cmap.lookup(8)).toBeUndefined();
    expect(diagnostics).toEqual([]);
  });

  it("keeps a shared prefix fixed while only the final code unit increments", () => {
    const { sink } = collectDiagnostics();
    // Destination is 'X' (0058) + a base unit 0041 -- only the trailing unit increments across the range.
    const cmap = parseToUnicodeCMap(
      textBytes("beginbfrange\n<0000> <0002> <00580041>\nendbfrange"),
      sink,
    );
    expect(cmap.lookup(0)).toBe("XA");
    expect(cmap.lookup(1)).toBe("XB");
    expect(cmap.lookup(2)).toBe("XC");
  });

  it("reads the base unit's high byte from the byte immediately before the low byte, not some other offset", () => {
    // Base unit 0x3041 has a non-zero high byte (0x30), unlike the 0x0041 fixture above, so a wrong offset into dstBytes for the high byte produces a visibly different character rather than coincidentally the same one.
    const { sink } = collectDiagnostics();
    const cmap = parseToUnicodeCMap(
      textBytes("beginbfrange\n<0000> <0001> <00513041>\nendbfrange"),
      sink,
    );
    expect(cmap.lookup(0)).toBe("Q" + String.fromCharCode(0x3041));
    expect(cmap.lookup(1)).toBe("Q" + String.fromCharCode(0x3042));
  });

  it("maps nothing for a range whose single destination is too short to carry even one UTF-16BE code unit", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const cmap = parseToUnicodeCMap(
      textBytes("beginbfrange\n<0005> <0007> <00>\nendbfrange"),
      sink,
    );
    expect(cmap.lookup(5)).toBeUndefined();
    expect(cmap.lookup(6)).toBeUndefined();
    expect(cmap.lookup(7)).toBeUndefined();
    expect(diagnostics).toEqual([]);
  });

  it("maps each code independently when the destination is an array", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const cmap = parseToUnicodeCMap(
      textBytes(
        "beginbfrange\n<0000> <0002> [<0041> <0058> <0059>]\nendbfrange",
      ),
      sink,
    );
    expect(cmap.lookup(0)).toBe("A");
    expect(cmap.lookup(1)).toBe("X");
    expect(cmap.lookup(2)).toBe("Y");
    expect(diagnostics).toEqual([]);
  });

  it("reports a diagnostic and skips an entry whose high end isn't a hex string", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const cmap = parseToUnicodeCMap(
      textBytes("beginbfrange\n<0005> 42\n<0008> <0009> <0044>\nendbfrange"),
      sink,
    );
    expect(cmap.lookup(5)).toBeUndefined();
    expect(cmap.lookup(8)).toBe("D");
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "pdf/cmap-entry-invalid",
        message: "bfrange entry had no valid high-end hex string",
      }),
    ]);
  });

  it("reports a diagnostic and stops cleanly when an array destination is truncated before its closing bracket", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const cmap = parseToUnicodeCMap(
      textBytes("beginbfrange\n<0000> <0002> [<0041>"),
      sink,
    );
    expect(cmap.lookup(0)).toBe("A");
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "pdf/cmap-truncated",
        message: "bfrange array destination was truncated",
      }),
      expect.objectContaining({
        code: "pdf/cmap-truncated",
        message: "bfrange section was truncated before endbfrange",
      }),
    ]);
  });

  it("reports a diagnostic and maps nothing for a destination that is neither a hex string nor an array", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const cmap = parseToUnicodeCMap(
      textBytes("beginbfrange\n<0005> <0007> 42\nendbfrange"),
      sink,
    );
    expect(cmap.lookup(5)).toBeUndefined();
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "pdf/cmap-entry-invalid",
        message: "bfrange entry had no valid destination",
      }),
    ]);
  });

  it("does not stop at a stray keyword that isn't endbfrange, and reports no diagnostic for a well-formed section", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const cmap = parseToUnicodeCMap(
      textBytes(
        "beginbfrange\n<0005> <0007> <0043>\nsomestrayword\n<0008> <0009> <0044>\nendbfrange",
      ),
      sink,
    );
    expect(cmap.lookup(5)).toBe("C");
    expect(cmap.lookup(8)).toBe("D");
    expect(cmap.lookup(9)).toBe("E");
    expect(diagnostics).toEqual([]);
  });

  it("reports a diagnostic and stops cleanly when truncated before endbfrange", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const cmap = parseToUnicodeCMap(
      textBytes("beginbfrange\n<0005> <0007> <0043>"),
      sink,
    );
    expect(cmap.lookup(5)).toBe("C");
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "pdf/cmap-truncated",
        message: "bfrange section was truncated before endbfrange",
      }),
    ]);
  });
});

describe("parseToUnicodeCMap: surrounding PostScript boilerplate", () => {
  it("ignores everything outside bfchar/bfrange sections, including codespacerange and dict/begin/end noise", () => {
    const { sink, diagnostics } = collectDiagnostics();
    const cmap = parseToUnicodeCMap(
      textBytes(
        "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n1 beginbfchar\n<0003> <0041>\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend",
      ),
      sink,
    );
    expect(cmap.lookup(3)).toBe("A");
    expect(diagnostics).toEqual([]);
  });
});
