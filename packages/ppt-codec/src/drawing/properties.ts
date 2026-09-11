import { PptFormatError } from "../errors";
import { type PptRecord, childRecords } from "../record/tree";
import {
  OfficeArtFOPT,
  OfficeArtSecondaryFOPT,
  OfficeArtTertiaryFOPT,
} from "../record/types";
import { concatBytes, u16le, u32le, writeAtom } from "../record/write";

// The [MS-ODRAW] shape property table: the one mechanism a shape states anything about itself beyond its identity and anchor -- which blip a picture displays, how far a shape is rotated, and the fact that a group of shapes is a table. Every table shares the identical framing: recVer 0x3, rh.recInstance = the property count, a run of 6-byte OfficeArtFOPTE entries (a 2-byte OfficeArtFOPTEOPID header plus a 4-byte value), then the pooled bytes of whichever entries declared themselves complex. OfficeArtFOPT 2.2.9: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/10dc2fe1-9e69-48dc-a1d1-2921dfb9c28e OfficeArtSecondaryFOPT 2.2.10: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/a7b26490-a8c7-4087-904e-417b10839f77 OfficeArtTertiaryFOPT 2.2.11: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/a687e90c-1748-4f57-8758-be31cfb36185 OfficeArtFOPTE 2.2.7: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/2841bed9-1ff1-4981-807e-ffb9592c046d OfficeArtFOPTEOPID 2.2.8: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/1de69035-9084-4f76-9d95-701f410bed2e

// OfficeArtFOPTEOPID's own field split: a 14-bit property identifier in the low bits, then fComplex (bit 14), then fBid (bit 15). fComplex says this entry's 4-byte value is a byte length and its real payload sits in the pooled complex data after the entry run; fBid says the value is a one-based reference into the document's blip store rather than a plain integer.
const OPID_MASK = 0x3fff;
const OPID_FCOMPLEX = 1 << 14;
const OPID_FBID = 1 << 15;

// The property identifiers this package reads or writes -- each taken from its own specification page rather than from a neighbour's numbering. rotation 2.3.18.5: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/9ecbf9c9-9774-4669-94b1-55c2eb365901 pib 2.3.23.5: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/a12e8c5e-a764-49d5-b407-c27bf933920d tableProperties 2.3.4.36: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/376e9c97-16df-45f2-bd6b-a67ba657ef4c tableRowProperties 2.3.4.37: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/45891407-a4b1-4f26-93a8-ded15531c62c
export const PROPERTY_ROTATION = 0x0004;
export const PROPERTY_PIB = 0x0104;
export const PROPERTY_TABLE_PROPERTIES = 0x039f;
export const PROPERTY_TABLE_ROW_PROPERTIES = 0x03a0;

// The four text-inset properties, each a plain signed EMU value with its own specification page: dxTextLeft: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/e89d660e-4f08-4786-a159-ee90cc76c9ac dyTextTop: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/7bb231df-17ce-4111-8eba-9a8337e96563 dxTextRight: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/4d1d87bd-e76f-4f26-a86f-82b26f2c1b9b dyTextBottom: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/a1e315f3-bec7-418a-b872-379cf08bbeba -- each property's own default (0x00016530 EMU for the left/right pair, 0x0000B298 for top/bottom) is the 0.1in/0.05in pair read.ts's DEFAULT_INSET_LEFT_RIGHT_PT/DEFAULT_INSET_TOP_BOTTOM_PT already state, so a shape with none of the four present needs no fallback beyond those constants.
export const PROPERTY_DX_TEXT_LEFT = 0x0081;
export const PROPERTY_DY_TEXT_TOP = 0x0082;
export const PROPERTY_DX_TEXT_RIGHT = 0x0083;
export const PROPERTY_DY_TEXT_BOTTOM = 0x0084;

// rotation's value is a Fixed Point ([MS-OSHARED] 2.2.1.6): a signed 32-bit number whose high 16 bits are the whole degrees and whose low 16 bits are the fraction, so the conversion in either direction is a multiply or divide by exactly 2^16 -- and a whole number of degrees is exactly representable, which is what ContentShape.rotationDeg's consumers hand this writer.
const FIXED_POINT_ONE = 0x10000;

export function degreesToFixedPoint(degrees: number): number {
  return Math.round(degrees * FIXED_POINT_ONE);
}

export function fixedPointToDegrees(raw: number): number {
  return raw / FIXED_POINT_ONE;
}

// TABLEFLAGS (2.2.59), the 4-byte value of the tableProperties property: fIsTable is bit 0, fIsTablePlaceholder bit 1, fIsTableRTL bit 2. Only fIsTable is acted on -- it is what distinguishes a table's group of shapes from an ordinary group. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/346608a3-bca2-4607-b98b-5f3c77f607d2
export const TABLE_FLAG_IS_TABLE = 1 << 0;

// IMsoArray (2.2.51), the framing of a complex property whose payload is a run of same-sized elements: nElems, nElemsAlloc, cbElem, then the data. tableRowProperties_complex is one of 4-byte signed integers -- the rows' minimum heights in master units. https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-odraw/f68b7770-f7fb-4b1a-bafa-d46054ee0435
export function readIMsoArray(
  complex: Uint8Array<ArrayBuffer>,
): readonly number[] {
  if (complex.length < 6) {
    throw new PptFormatError(
      `a complex property's IMsoArray carries ${complex.length} bytes, fewer than the 6 its three count fields need`,
    );
  }
  const view = new DataView(
    complex.buffer,
    complex.byteOffset,
    complex.byteLength,
  );
  const elementCount = view.getUint16(0, true);
  const elementSize = view.getUint16(4, true);
  const data = complex.subarray(6);
  if (data.length < elementCount * elementSize) {
    throw new PptFormatError(
      `a complex property's IMsoArray declares ${elementCount} elements of ${elementSize} bytes but only ${data.length} remain`,
    );
  }
  const elements: number[] = [];
  for (let index = 0; index < elementCount; index += 1) {
    elements.push(view.getInt32(6 + index * elementSize, true));
  }
  return elements;
}

export function writeIMsoArray(
  elements: readonly number[],
  elementSize: number,
): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(elements.length * elementSize);
  const view = new DataView(data.buffer);
  elements.forEach((element, index) => {
    view.setInt32(index * elementSize, element, true);
  });
  return concatBytes(
    u16le(elements.length),
    u16le(elements.length),
    u16le(elementSize),
    data,
  );
}

// The property tables a single shape carries, merged across all three of the positions [MS-ODRAW] 2.2.14 allows one at. A property appearing in more than one table is a producer artefact this package has never seen; the later table wins here purely so the merge has a deterministic order (primary, then secondary, then tertiary) rather than because the specification states a precedence.
export interface ShapeProperty {
  readonly value: number;
  readonly complex: Uint8Array<ArrayBuffer> | undefined;
}

export function readShapeProperties(
  shape: PptRecord,
): Map<number, ShapeProperty> {
  const properties = new Map<number, ShapeProperty>();
  for (const record of childRecords(shape)) {
    if (
      record.header.recType !== OfficeArtFOPT &&
      record.header.recType !== OfficeArtSecondaryFOPT &&
      record.header.recType !== OfficeArtTertiaryFOPT
    ) {
      continue;
    }
    const count = record.header.recInstance;
    const needed = count * 6;
    if (record.data.length < needed) {
      throw new PptFormatError(
        `a shape property table declares ${count} properties but its ${record.data.length} bytes of data cannot hold the ${needed} its entries need`,
      );
    }
    const view = new DataView(
      record.data.buffer,
      record.data.byteOffset,
      record.data.byteLength,
    );
    let complexAt = needed;
    for (let index = 0; index < count; index += 1) {
      const at = index * 6;
      const opid = view.getUint16(at, true);
      const value = view.getInt32(at + 2, true);
      const isComplex = (opid & OPID_FCOMPLEX) !== 0;
      let complex: Uint8Array<ArrayBuffer> | undefined;
      if (isComplex) {
        complex = record.data.subarray(complexAt, complexAt + value);
        complexAt += value;
        if (complexAt > record.data.length) {
          throw new PptFormatError(
            `a shape property table's complex data declares ${complexAt} bytes in total but the table carries only ${record.data.length}`,
          );
        }
      }
      properties.set(opid & OPID_MASK, { value, complex });
    }
  }
  return properties;
}

// One entry of a property table this package writes. `op` is the 4-byte value for a plain property or the payload's own length for a complex one -- the two cases the fComplex bit distinguishes on read.
export interface WritableShapeProperty {
  readonly opid: number;
  readonly op: number;
  readonly fBid?: boolean;
  readonly complex?: Uint8Array<ArrayBuffer>;
}

// Writes one property table record. `recType` picks which of the three positions the table lands in -- a shape's own rotation and blip reference belong in the primary OfficeArtFOPT, while a table group's tableProperties/tableRowProperties go where a real producer puts them, the tertiary table (confirmed against LibreOffice's own import, which seeks DFF_msofbtUDefProp -- recType 0xF122 -- for them). Entries are emitted in ascending opid order, the order every producer observed emits them in and the one that keeps a table combining several of this package's properties byte-stable.
export function writeShapePropertyTable(
  recType: number,
  entries: readonly WritableShapeProperty[],
): Uint8Array<ArrayBuffer> {
  const ordered = [...entries].sort((a, b) => a.opid - b.opid);
  const complexParts: Uint8Array<ArrayBuffer>[] = [];
  const entryParts = ordered.map((entry) => {
    const isComplex = entry.complex !== undefined;
    // fBid is independent of fComplex in OfficeArtFOPTEOPID's own bit layout, and a real producer sets both on a complex property (Microsoft Office PowerPoint's own table writes set fComplex and fBid together on tableRowProperties -- confirmed by inspecting its raw bytes), so no special case excludes one with the other.
    const opidWord =
      entry.opid |
      (isComplex ? OPID_FCOMPLEX : 0) |
      (entry.fBid === true ? OPID_FBID : 0);
    if (isComplex) {
      complexParts.push(entry.complex);
    }
    return concatBytes(u16le(opidWord), u32le(entry.op));
  });
  return writeAtom(recType, concatBytes(...entryParts, ...complexParts), {
    recVer: 0x3,
    recInstance: ordered.length,
  });
}
