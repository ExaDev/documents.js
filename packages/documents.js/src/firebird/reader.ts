// A forward-only byte cursor over a Firebird gbak backup (.fbk) stream, plus the several distinct primitive encodings that stream mixes -- see the package README's .odb Tier 3 Gotchas entry for the full empirical derivation. Deliberately independent of src/bytes/reader.ts's own ByteReader: that reader is tuned for PDF's byte/backtracking lexical needs (mark/reset, ASCII whitespace) and has no notion of any encoding below.
//
// Encoding 1 -- "attribute" values (every att_type's own tag+length+value triple, and every rec_type major-record tag byte): a single length-prefixed byte for the tag, then (for attributes with a value) a single length byte followed by that many raw bytes, the multi-byte forms (int32/int64) written low-byte-first ("VAX"/little-endian order, confirmed against gbak's own backup.epp put_int32: `isc_vax_integer`). This is FirebirdBackupReader's readTag/readAttribute/readInt32Attribute/readTextAttribute below. NOTE, a real correction made only after testing against a real generated fixture: att_backup_compress/att_backup_transportable are NOT put_boolean's own 1-byte form -- mvol.cpp's write_header writes them via put_numeric (a 4-byte int32, always literally 1), and ONLY WHEN THE FLAG IS TRUE AT ALL (`if (tdgbl->gbl_sw_compress) put_numeric(att_backup_compress, 1);`) -- the attribute's own PRESENCE is the true/false signal, not any encoded value.
//
// Encoding 2 -- row DATA payload bytes (the bytes following an att_data_data tag inside a rec_data record, only ever present when the backup's own att_backup_transportable attribute is true -- confirmed true in every real fixture this reader was built against): standard XDR (RFC 1832), big-endian, every value widened to a 4-byte-aligned unit (even a nominally 16-bit SSHORT goes out as a full 4-byte XDR long, per gbak's own xdr.cpp xdr_short: `temp = *ip; PUTLONG(xdrs, &temp)`), opaque byte runs padded to the next 4-byte boundary with zero filler. This is XdrReader below, used only while decoding a row's own att_data_data payload.
//
// Encoding 3 -- RLE compression, ANOTHER genuine correction this reader's own construction caught only by testing against a real generated fixture (a real LibreOffice 26.2 Firebird-embedded .odb backs up with att_backup_compress present -- gbak's own compression default, not a special option this fixture happened to opt into). When present, att_data_data's own bytes are NOT the XDR buffer directly -- backup.epp's put_data RLE-compresses the ALREADY-XDR-ENCODED buffer before writing it (`if (tdgbl->gbl_sw_compress) compress(p, record_length);`, where `p`/`record_length` at that point are the XDR output, not the raw record). The scheme itself (backup.epp's compress/restore.epp's decompress) is a classic signed-run-length ("PackBits"-style) codec: a signed control byte `count`; count>0 means "copy the next `count` bytes literally"; count<0 means "read one more byte and repeat it `-count` times"; the decompressed length is already known ahead of time from att_xdr_length, so decoding stops once that many output bytes have been produced, however many COMPRESSED input bytes that took. This is readCompressedPayload below -- unlike readRawPayload, its own input byte count is not known until decoding finishes, so it reads directly from the underlying tag/attribute stream rather than being handed a pre-sliced byte range.

export class FirebirdBackupParseError extends Error {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(`Firebird backup parse error at byte offset ${offset}: ${message}`);
    this.name = "FirebirdBackupParseError";
    this.offset = offset;
  }
}

// Reads the generic tag+length+value attribute stream every rec_* major record's own attribute list is built from (backup.epp's put_asciz/put_int32/put_int64/put_boolean; restore.epp's mirroring get_text/get_int32/get_int64/get_boolean). NOT used for a rec_data record's own att_data_data payload, whose bytes have no length prefix of their own at all -- see the top-of-file note above and readDataPayload below.
export class FirebirdBackupReader {
  private readonly bytes: Uint8Array<ArrayBuffer>;
  private position = 0;

  constructor(bytes: Uint8Array<ArrayBuffer>) {
    this.bytes = bytes;
  }

  get offset(): number {
    return this.position;
  }

  atEnd(): boolean {
    return this.position >= this.bytes.length;
  }

  // A single raw tag byte -- both rec_type (major record kind) and att_type (attribute kind) are always exactly one byte on the wire (backup.epp's own `put(BurpGlobals*, const att_type c)` casts to UCHAR unconditionally; restore.epp's get_record/get_attribute read exactly one byte back).
  readTag(): number {
    const byte = this.bytes[this.position];
    if (byte === undefined) {
      throw new FirebirdBackupParseError(
        "unexpected end of stream reading a tag byte",
        this.position,
      );
    }
    this.position++;
    return byte;
  }

  peekTag(): number | undefined {
    return this.bytes[this.position];
  }

  // The one-byte length prefix almost every attribute value carries (get_text's own `const ULONG l = get(tdgbl);`) -- a plain unsigned byte, 0-255, not a variable-length/continuation encoding (confirmed against real fixture bytes: a 129-byte file-path attribute is encoded as the literal byte 0x81, not a two-byte "long form" length).
  private readLengthByte(): number {
    const byte = this.bytes[this.position];
    if (byte === undefined) {
      throw new FirebirdBackupParseError(
        "unexpected end of stream reading an attribute length byte",
        this.position,
      );
    }
    this.position++;
    return byte;
  }

  private readRawBytes(length: number): Uint8Array<ArrayBuffer> {
    if (this.position + length > this.bytes.length) {
      throw new FirebirdBackupParseError(
        `unexpected end of stream reading ${length} raw byte(s)`,
        this.position,
      );
    }
    const slice = this.bytes.subarray(this.position, this.position + length);
    this.position += length;
    return slice;
  }

  // A length-prefixed attribute value's raw bytes, with no interpretation -- the generic form every att_* attribute (other than rec_data's own att_data_data, see readDataPayload) is built from.
  readAttributeBytes(): Uint8Array<ArrayBuffer> {
    const length = this.readLengthByte();
    return this.readRawBytes(length);
  }

  // A length-prefixed little-endian ("VAX order") signed 32-bit attribute value -- get_int32's own wire shape (put_int32: `isc_vax_integer`, low byte first). Used for every att_*_length/att_*_type/att_*_scale/att_*_sub_type/etc. integer attribute.
  readInt32Attribute(): number {
    const bytes = this.readAttributeBytes();
    if (bytes.length !== 4) {
      throw new FirebirdBackupParseError(
        `expected a 4-byte int32 attribute, found ${bytes.length} byte(s)`,
        this.position,
      );
    }
    return (
      (bytes[0] ?? 0) |
      ((bytes[1] ?? 0) << 8) |
      ((bytes[2] ?? 0) << 16) |
      ((bytes[3] ?? 0) << 24)
    );
  }

  // A length-prefixed attribute value decoded as text. Real gbak output is always plain ASCII/Latin-1 for the identifiers and paths this reader cares about (table/column names, file paths); UTF-8 decoding degrades gracefully to the same result for that range and correctly handles a UTF-8-encoded name should one appear.
  readTextAttribute(): string {
    const bytes = this.readAttributeBytes();
    return new TextDecoder("utf-8").decode(bytes);
  }

  // Skips one full attribute (tag already consumed by the caller via readTag; this reads and discards its length-prefixed value) -- the generic mechanism this reader uses to walk past any attribute whose own meaning is out of scope (relation/field/database attributes this reader has no use for), without losing stream alignment. Never valid for att_data_data (see readDataPayload) -- callers must special-case that tag before reaching here. NOT valid either for a genuinely blob-valued attribute (att_relation_view_blr/att_field_default_value/att_trig_blr/att_trig_source and similar -- a compound "length-of-length then raw bytes" shape restore.epp's own get_blr_blob/get_misc_blob/get_source_blob read, wider than the plain ≤255-byte value every other attribute uses) -- a real, tracked, bounded gap this reader's own real fixture never exercises (no relation/field/index/trigger in it carries a description, default value, or BLR body) but would misalign the stream on a real file that does. See the package README's .odb Tier 3 Fidelity note.
  skipAttributeValue(): void {
    this.readAttributeBytes();
  }

  // Skips every remaining attribute of the CURRENT record (the record's own leading tag already consumed by the caller), stopping at att_end -- the generic "this record kind's own attribute vocabulary is entirely out of scope" mechanism used for every record kind this reader recognises by shape (flat, attribute-list-only) but not by meaning.
  skipFlatRecordAttributes(): void {
    for (;;) {
      const attribute = this.readTag();
      if (attribute === 0) {
        return;
      }
      this.skipAttributeValue();
    }
  }

  // Reads exactly `length` raw bytes with NO length prefix of their own -- the one genuine exception to the tag+length+value convention (see this module's own top-of-file note). Used for att_data_data's own payload, whose byte count was already given by a preceding att_data_length/att_xdr_length attribute, and for a blob segment's own body (preceded by its own explicit 2-byte length, read separately by the caller).
  readRawPayload(length: number): Uint8Array<ArrayBuffer> {
    return this.readRawBytes(length);
  }

  // A blob segment's own 2-byte length prefix, written low-byte-first as two individual bytes (put_blob: `put(tdgbl, (UCHAR)(segment_length)); put(tdgbl, (UCHAR)(segment_length >> 8));` -- i.e. still little-endian, but NOT going through the generic length-byte convention above since a segment has no leading tag of its own).
  readBlobSegmentLength(): number {
    const low = this.readLengthByte();
    const high = this.readLengthByte();
    return low | (high << 8);
  }

  private readSignedByte(): number {
    const byte = this.bytes[this.position];
    if (byte === undefined) {
      throw new FirebirdBackupParseError(
        "unexpected end of stream reading a compression control byte",
        this.position,
      );
    }
    this.position++;
    return byte >= 0x80 ? byte - 0x100 : byte;
  }

  // restore.epp's own decompress() algorithm (a classic signed-run-length/"PackBits"-style codec), reading directly from this reader's own underlying stream -- see this module's own top-of-file Encoding 3 note for the full derivation. Reads however many COMPRESSED bytes it takes to produce exactly `decompressedLength` bytes of OUTPUT (the count att_xdr_length already gave the caller), so the caller never needs to know the compressed byte count up front.
  readCompressedPayload(decompressedLength: number): Uint8Array<ArrayBuffer> {
    const output = new Uint8Array(decompressedLength);
    let written = 0;
    while (written < decompressedLength) {
      const count = this.readSignedByte();
      if (count > 0) {
        const remaining = decompressedLength - written;
        const take = Math.min(count, remaining);
        const literal = this.readRawBytes(take);
        output.set(literal, written);
        written += take;
      } else if (count < 0) {
        const repeatCount = Math.min(-count, decompressedLength - written);
        const fillByte = this.readLengthByte();
        output.fill(fillByte, written, written + repeatCount);
        written += repeatCount;
      }
      // count === 0 is a genuine no-op in the real decoder (an empty run) -- never expected in practice, but looping back to read the next control byte rather than treating it as an error matches restore.epp's own permissive behaviour exactly.
    }
    return output;
  }
}

// Standard XDR (RFC 1832) reader over a rec_data record's own att_data_data payload bytes -- big-endian, 4-byte-aligned throughout, confirmed against Firebird's own src/common/xdr.cpp (GETLONG uses ntohl unconditionally since BurpXdr never sets x_local) and src/burp/canonical.cpp's CAN_encode_decode (the exact per-SQL-type XDR shape gbak uses for a row's own field values). A completely different byte order and framing from FirebirdBackupReader above -- the two must never be mixed mid-stream.
export class XdrReader {
  private readonly bytes: Uint8Array<ArrayBuffer>;
  private position: number;
  private readonly end: number;

  constructor(bytes: Uint8Array<ArrayBuffer>, start = 0, end = bytes.length) {
    this.bytes = bytes;
    this.position = start;
    this.end = end;
  }

  get offset(): number {
    return this.position;
  }

  atEnd(): boolean {
    return this.position >= this.end;
  }

  // A big-endian 32-bit signed integer -- the wire shape underlying xdr_long AND xdr_short (xdr_short widens its 16-bit value to a full XDR long on the wire; see readInt16 below).
  readInt32(): number {
    if (this.position + 4 > this.end) {
      throw new FirebirdBackupParseError(
        "unexpected end of XDR data reading a 4-byte integer",
        this.position,
      );
    }
    const b0 = this.bytes[this.position] ?? 0;
    const b1 = this.bytes[this.position + 1] ?? 0;
    const b2 = this.bytes[this.position + 2] ?? 0;
    const b3 = this.bytes[this.position + 3] ?? 0;
    this.position += 4;
    // Signed 32-bit big-endian reassembly via a >>> 0 unsigned round-trip through `| 0` -- (b0<<24) alone can already overflow into unsigned-looking territory in JS bitwise ops, so build unsigned first, then reinterpret as signed with `| 0`.
    return (b0 << 24) | (b1 << 16) | (b2 << 8) | b3 | 0;
  }

  // xdr_short's own wire shape: NOT a 2-byte value -- Firebird's XDR has no native 16-bit type, so a "short" is sign-extended to a full 4-byte XDR long on encode (xdr.cpp: `temp = *ip; PUTLONG(xdrs, &temp);`) and truncated back to 16 bits with sign preserved on decode (`*ip = (SSHORT) temp;`).
  readInt16(): number {
    const value = this.readInt32();
    return (value << 16) >> 16;
  }

  // A big-endian 64-bit signed integer via xdr_hyper's own two-32-bit-word shape. A real bug this reader's own construction caught only against a real fixture (a DECIMAL(10,2) column's own int64-backed value decoded to garbage on the first pass): xdr_hyper's `temp_long` is a native-memory-layout copy of the int64 (`memcpy(temp_long, pi64, sizeof temp_long)`), so on every little-endian host real gbak actually runs on, `temp_long[0]` holds the LOW 32 bits and `temp_long[1]` the HIGH 32 bits purely as an artifact of memory layout -- but xdr.cpp's own `#ifndef WORDS_BIGENDIAN` encode branch then writes `temp_long[1]` (HIGH) FIRST, `temp_long[0]` (LOW) SECOND. The wire order is therefore HIGH-word-first, LOW-word-second -- the opposite of what "low-order half transmitted first" (this comment's own first-draft assumption) would suggest.
  readInt64(): bigint {
    const high = this.readInt32();
    const low = this.readInt32();
    return (BigInt(high) << 32n) | (BigInt(low) & 0xffffffffn);
  }

  // IEEE-754 double via xdr_double's own two-32-bit-word shape (`FB_LONG_DOUBLE_FIRST`/`FB_LONG_DOUBLE_SECOND` select which 32-bit half of the in-memory double is PUTLONG'd first -- the constant itself lives in a platform header this reader's own source research did not track down). Read here as the high-order word first, i.e. a standard big-endian IEEE-754 double with no further word-swap -- cross-checked against a real Firebird-embedded fixture's own DOUBLE PRECISION column value (see src/firebird/backup.test.ts) and confirmed to decode correctly on the little-endian (x86/ARM) hosts every real gbak build this reader was tested against actually runs on.
  readDouble(): number {
    if (this.position + 8 > this.end) {
      throw new FirebirdBackupParseError(
        "unexpected end of XDR data reading an 8-byte double",
        this.position,
      );
    }
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    for (let i = 0; i < 8; i++) {
      view.setUint8(i, this.bytes[this.position + i] ?? 0);
    }
    this.position += 8;
    return view.getFloat64(0, false);
  }

  readFloat(): number {
    if (this.position + 4 > this.end) {
      throw new FirebirdBackupParseError(
        "unexpected end of XDR data reading a 4-byte float",
        this.position,
      );
    }
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    for (let i = 0; i < 4; i++) {
      view.setUint8(i, this.bytes[this.position + i] ?? 0);
    }
    this.position += 4;
    return view.getFloat32(0, false);
  }

  // xdr_opaque: `len` raw bytes, then (4 - len) & 3 zero filler bytes -- every opaque run is padded to a 4-byte boundary regardless of its own declared length.
  readOpaque(len: number): Uint8Array<ArrayBuffer> {
    if (this.position + len > this.end) {
      throw new FirebirdBackupParseError(
        `unexpected end of XDR data reading ${len} opaque byte(s)`,
        this.position,
      );
    }
    const slice = this.bytes.subarray(this.position, this.position + len);
    this.position += len;
    const padding = (4 - (len % 4)) % 4;
    this.position += padding;
    return slice;
  }
}
