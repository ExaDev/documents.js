// Hand-built sfnt tables describing a font as a whole rather than its glyph encoding: 'name', 'hhea' and 'hmtx', for tests that assemble a synthetic font through test-support/sfnt.ts's buildSfnt. Built by literal byte layout against ISO/IEC 14496-22, importing nothing from this package's own sfnt readers, for the reason that file's header states.

// A minimal, hand-built 'name' table — the same record layout font-tables.test.ts's own buildFontWithNameTable uses (clause 5.2.7), returning the bare table bytes so it can be combined with other synthetic tables via buildSfnt.
export function buildNameTable(
  records: readonly {
    platformId: number;
    encodingId: number;
    nameId: number;
    text: string;
  }[],
): Uint8Array<ArrayBuffer> {
  const NAME_HEADER_SIZE = 6;
  const NAME_RECORD_SIZE = 12;
  const storageOffset = NAME_HEADER_SIZE + records.length * NAME_RECORD_SIZE;
  const encoded = records.map((record) =>
    Uint8Array.from(
      [...record.text].flatMap((character) => [
        character.charCodeAt(0) >> 8,
        character.charCodeAt(0) & 0xff,
      ]),
    ),
  );
  const storageLength = encoded.reduce(
    (total, bytes) => total + bytes.length,
    0,
  );
  const table = new Uint8Array(storageOffset + storageLength);
  const view = new DataView(table.buffer);
  view.setUint16(2, records.length);
  view.setUint16(4, storageOffset);
  let stringOffset = 0;
  records.forEach((record, index) => {
    const recordOffset = NAME_HEADER_SIZE + index * NAME_RECORD_SIZE;
    const encodedRecord = encoded[index]!;
    view.setUint16(recordOffset, record.platformId);
    view.setUint16(recordOffset + 2, record.encodingId);
    view.setUint16(recordOffset + 6, record.nameId);
    view.setUint16(recordOffset + 8, encodedRecord.length);
    view.setUint16(recordOffset + 10, stringOffset);
    table.set(encodedRecord, storageOffset + stringOffset);
    stringOffset += encodedRecord.length;
  });
  return table;
}

// A minimal 'hhea' (ISO/IEC 14496-22 clause 5.2.3): only numberOfHMetrics, at its real byte offset 34, is meaningful here.
export function buildHheaTable(
  numberOfHMetrics: number,
): Uint8Array<ArrayBuffer> {
  const table = new Uint8Array(36);
  new DataView(table.buffer).setUint16(34, numberOfHMetrics);
  return table;
}

// A minimal 'hmtx' (clause 5.2.4): one 4-byte longHorMetric (advanceWidth uint16, leftSideBearing int16) per declared metric, in order.
export function buildHmtxTable(
  advanceWidths: readonly number[],
): Uint8Array<ArrayBuffer> {
  const table = new Uint8Array(advanceWidths.length * 4);
  const view = new DataView(table.buffer);
  advanceWidths.forEach((width, index) => {
    view.setUint16(index * 4, width);
  });
  return table;
}
