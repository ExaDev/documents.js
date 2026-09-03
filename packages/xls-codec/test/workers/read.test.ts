import { describe, expect, it } from "vitest";

import {
  BOF_TYPE_WORKBOOK,
  BOF_TYPE_WORKSHEET,
  classifyNumberFormat,
  decodeRkNumber,
  isXlsFile,
  RECORD_BOF,
  RECORD_BOUNDSHEET8,
  RECORD_EOF,
  RECORD_LABELSST,
  RECORD_NUMBER,
  RECORD_SST,
  RECORD_XF,
  readRecords,
  readXls,
  readXlsContent,
  serialToIsoDate,
} from "../../src/index";

// The same reading path the node suite exercises, run inside workerd -- the real Cloudflare Workers runtime -- so this package's Worker-isomorphism is a runtime-checked fact rather than an assertion. If any code path here (or in archive-codec's compound-file reader beneath it) reached for a Node-only API, this isolate would throw rather than the test passing.
//
// The fixture is built inline rather than through src/test-support, which the published build excludes and which uses Node conveniences the isolate does not have.

function u16(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}

function u32(value: number): number[] {
  return [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ];
}

function f64(value: number): number[] {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setFloat64(0, value, true);
  return [...new Uint8Array(buffer)];
}

function record(type: number, data: readonly number[]): number[] {
  return [...u16(type), ...u16(data.length), ...data];
}

function bofData(documentType: number): number[] {
  return [
    ...u16(0x0600),
    ...u16(documentType),
    ...u16(0x0dbb),
    ...u16(0x07cc),
    ...u32(0x41),
    ...u32(0x206),
  ];
}

function shortString(text: string): number[] {
  return [text.length, 0x00, ...[...text].map((char) => char.charCodeAt(0))];
}

function richString(text: string): number[] {
  return [
    ...u16(text.length),
    0x00,
    ...[...text].map((char) => char.charCodeAt(0)),
  ];
}

/** Fifteen style XFs then one cell XF, so a cell's ixfe of 15 lands on the cell format. */
function xfTable(formatId: number): number[] {
  const styles = Array.from({ length: 15 }, () =>
    record(RECORD_XF, [...u16(0), ...u16(0), ...u16(0x0004), ...u16(0)]),
  ).flat();
  return [
    ...styles,
    ...record(RECORD_XF, [...u16(0), ...u16(formatId), ...u16(0), ...u16(0)]),
  ];
}

function workbookStreamBytes(): Uint8Array<ArrayBuffer> {
  const sheetStream = [
    ...record(RECORD_BOF, bofData(BOF_TYPE_WORKSHEET)),
    ...record(RECORD_NUMBER, [
      ...u16(0),
      ...u16(0),
      ...u16(15),
      ...f64(45292),
    ]),
    ...record(RECORD_LABELSST, [
      ...u16(1),
      ...u16(0),
      ...u16(15),
      ...u32(0),
    ]),
    ...record(RECORD_EOF, []),
  ];
  // The globals substream's own length is what BoundSheet8's lbPlyPos has to name, so it is measured with a placeholder offset first and rebuilt with the real one -- both are the same size.
  const globalsWith = (offset: number): number[] => [
    ...record(RECORD_BOF, bofData(BOF_TYPE_WORKBOOK)),
    ...xfTable(14),
    ...record(RECORD_SST, [...u32(1), ...u32(1), ...richString("Hi")]),
    ...record(RECORD_BOUNDSHEET8, [
      ...u32(offset),
      0x00,
      0x00,
      ...shortString("Sheet1"),
    ]),
    ...record(RECORD_EOF, []),
  ];
  const globals = globalsWith(globalsWith(0).length);
  const body = [...globals, ...sheetStream];
  // Padded past the 4096-byte mini-stream cutoff with well-framed filler records placed AFTER the final EOF -- outside any substream, so splitSubstreams ignores them -- which keeps the stream FAT-resident and lets the fixture below skip building a mini-FAT. Zero-padding the bytes instead would leave a truncated record header at the end.
  const FILLER_TYPE = 0x005e;
  while (body.length < 4096) {
    body.push(...record(FILLER_TYPE, new Array<number>(1024).fill(0)));
  }
  return new Uint8Array(body);
}

/**
 * A minimal [MS-CFB] version-3 compound file holding one stream, built inline.
 *
 * Only the shape archive-codec's reader needs: a 512-byte header, one FAT sector, one directory sector, and the stream's own sectors -- the stream is written above the 4096-byte mini-stream cutoff so it is FAT-resident and no mini-FAT is needed.
 */
function compoundFileWith(
  name: string,
  stream: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const SECTOR = 512;
  const ENDOFCHAIN = 0xfffffffe;
  const FREESECT = 0xffffffff;
  const FATSECT = 0xfffffffd;
  const NOSTREAM = 0xffffffff;

  // The sectors hold whole-sector-aligned bytes, but the directory entry declares the stream's REAL length -- which is what the reader truncates to, so the trailing sector padding never reaches the record parser.
  const payload = new Uint8Array(Math.ceil(stream.length / SECTOR) * SECTOR);
  payload.set(stream);
  const dataSectors = payload.length / SECTOR;
  const totalSectors = 1 + 1 + dataSectors; // FAT, directory, then the data.

  const out = new Uint8Array(SECTOR * (1 + totalSectors));
  const view = new DataView(out.buffer);

  out.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  view.setUint16(0x18, 0x003e, true); // minor version
  view.setUint16(0x1a, 0x0003, true); // major version 3
  view.setUint16(0x1c, 0xfffe, true); // little-endian marker
  view.setUint16(0x1e, 9, true); // sector shift: 512 bytes
  view.setUint16(0x20, 6, true); // mini sector shift: 64 bytes
  view.setUint32(0x2c, 1, true); // FAT sector count
  view.setUint32(0x30, 1, true); // first directory sector
  view.setUint32(0x38, 4096, true); // mini-stream cutoff
  view.setUint32(0x3c, ENDOFCHAIN, true); // first mini-FAT sector
  view.setUint32(0x40, 0, true); // mini-FAT sector count
  view.setUint32(0x44, ENDOFCHAIN, true); // first DIFAT sector
  view.setUint32(0x48, 0, true); // DIFAT sector count
  view.setUint32(0x4c, 0, true); // DIFAT[0] = sector 0 holds the FAT
  for (let index = 1; index < 109; index += 1) {
    view.setUint32(0x4c + index * 4, FREESECT, true);
  }

  // Sector 0: the FAT. Entry 0 is the FAT sector itself, entry 1 the directory, then the data chain.
  const fatBase = SECTOR;
  for (let index = 0; index < SECTOR / 4; index += 1) {
    view.setUint32(fatBase + index * 4, FREESECT, true);
  }
  view.setUint32(fatBase, FATSECT, true);
  view.setUint32(fatBase + 4, ENDOFCHAIN, true);
  for (let index = 0; index < dataSectors; index += 1) {
    const sector = 2 + index;
    view.setUint32(
      fatBase + sector * 4,
      index === dataSectors - 1 ? ENDOFCHAIN : sector + 1,
      true,
    );
  }

  // Sector 1: the directory. Entry 0 is the root storage, entry 1 the stream.
  const dirBase = SECTOR * 2;
  const writeEntry = (
    slot: number,
    entryName: string,
    objectType: number,
    child: number,
    start: number,
    size: number,
  ): void => {
    const base = dirBase + slot * 128;
    for (let index = 0; index < entryName.length; index += 1) {
      view.setUint16(base + index * 2, entryName.charCodeAt(index), true);
    }
    view.setUint16(base + entryName.length * 2, 0, true);
    view.setUint16(base + 0x40, (entryName.length + 1) * 2, true);
    view.setUint8(base + 0x42, objectType);
    view.setUint8(base + 0x43, 1); // black
    view.setUint32(base + 0x44, NOSTREAM, true); // left sibling
    view.setUint32(base + 0x48, NOSTREAM, true); // right sibling
    view.setUint32(base + 0x4c, child, true);
    view.setUint32(base + 0x74, start, true);
    view.setUint32(base + 0x78, size, true);
    view.setUint32(base + 0x7c, 0, true);
  };
  writeEntry(0, "Root Entry", 5, 1, ENDOFCHAIN, 0);
  writeEntry(1, name, 2, NOSTREAM, 2, stream.length);
  for (let slot = 2; slot < 4; slot += 1) {
    const base = dirBase + slot * 128;
    view.setUint8(base + 0x42, 0);
    view.setUint32(base + 0x44, NOSTREAM, true);
    view.setUint32(base + 0x48, NOSTREAM, true);
    view.setUint32(base + 0x4c, NOSTREAM, true);
  }

  out.set(payload, SECTOR * 3);
  return out;
}

describe("xls-codec inside workerd", () => {
  const file = compoundFileWith("Workbook", workbookStreamBytes());

  it("recognises a workbook", () => {
    expect(isXlsFile(file)).toBe(true);
  });

  it("reads the record stream", () => {
    expect(readRecords(workbookStreamBytes()).length).toBeGreaterThan(0);
  });

  it("reads a workbook to a ContentDocument", () => {
    const content = readXlsContent(file);

    expect(content.kind).toBe("spreadsheet");
    expect(content.sheets[0]?.name).toBe("Sheet1");
  });

  it("classifies a date cell through its number format", () => {
    // Exercises the format classifier and the serial conversion in the isolate, not just the record framing.
    expect(readXlsContent(file).sheets[0]?.cells[0]?.value).toEqual({
      kind: "date",
      value: "2024-01-01",
    });
  });

  it("reads a shared-string cell", () => {
    expect(readXlsContent(file).sheets[0]?.cells[1]?.value).toEqual({
      kind: "string",
      value: "Hi",
    });
  });

  it("assembles the document tree", () => {
    expect(readXls(file).kind).toBe("spreadsheet");
  });

  it("runs the pure decoders", () => {
    expect(decodeRkNumber(0x3ff80000)).toBe(1.5);
    expect(classifyNumberFormat("0.00%").kind).toBe("percentage");
    expect(serialToIsoDate(1, false)).toBe("1900-01-01");
  });
});
