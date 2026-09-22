import { ByteWriter } from "../bytes/writer";
import type { PdfObject } from "../objects";
import { pdfDict, pdfNum, pdfRef } from "../objects";
import { writeObject } from "../serialize";

// Assembles a complete classic-cross-reference PDF file around an already-built object list, through this package's own serialize.ts — the same write path writePdf's own tail uses. Unlike test-support/pdf.ts's FixtureBuilder (which deliberately avoids this package's own writer to keep the read-side test oracle independent), this helper exists for the opposite case: a write-side unit test that already has real PdfObject values from the module under test (buildEmbeddedFontObjects, buildMathFontObjects, ...) and wants the minimum well-formed document those objects can be read back from, written through the real serializer rather than reimplemented.
export interface AllocatedObject {
  readonly num: number;
  readonly value: PdfObject;
}

// `objects` must number its entries contiguously from 1 (no gaps, no repeats) — both this file's callers allocate that way already, matching write.ts's own fixed-order allocation, so the xref table below can record one offset per object as it is written rather than re-deriving the count from whatever numbers happen to appear.
export function assemblePdf(
  objects: readonly AllocatedObject[],
  rootNum: number,
): Uint8Array<ArrayBuffer> {
  const writer = new ByteWriter();
  writer.writeAscii("%PDF-1.7\n");
  const written = [...objects]
    .sort((a, b) => a.num - b.num)
    .map(({ num, value }) => {
      const offset = writer.length;
      writer.writeAscii(`${num} 0 obj\n`);
      writeObject(writer, value);
      writer.writeAscii("\nendobj\n");
      return { num, offset };
    });
  const maxObjNum = written[written.length - 1]!.num;
  const xrefOffset = writer.length;
  writer.writeAscii("xref\n");
  writer.writeAscii(`0 ${maxObjNum + 1}\n`);
  writer.writeAscii("0000000000 65535 f \n");
  for (const { offset } of written) {
    writer.writeAscii(`${offset.toString().padStart(10, "0")} 00000 n \n`);
  }
  writer.writeAscii("trailer\n");
  writeObject(
    writer,
    pdfDict({ Size: pdfNum(maxObjNum + 1), Root: pdfRef(rootNum, 0) }),
  );
  writer.writeAscii("\nstartxref\n");
  writer.writeAscii(`${xrefOffset}\n`);
  writer.writeAscii("%%EOF");
  return writer.toBytes();
}
