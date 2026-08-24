// A compact compound-file builder specialised to the single shape the embedded-object fixtures need: a classic OLE .bin payload (word|ppt/embeddings/oleObject1.bin) whose root storage holds one 'Package' stream wrapping the packaged file -- the exact real-world spelling of a Word/PowerPoint OLE embed of a non-OLE file. Mirrors archive-codec's own test-support writer (src/test-support/cfb.ts there, where the layout's full construction is documented); kept local rather than imported because test-support is excluded from every package's published dist, so it cannot cross package boundaries. Layout: sector 0 is the FAT, sector 1 the directory (root entry plus the Package stream entry), then the Package stream's own sectors when it is at or above the 4096-byte cutoff, then the mini stream and mini-FAT sectors when it is below. Test-support only, never published.

const SECTOR_SIZE = 512;
const MINI_SECTOR_SIZE = 64;
const MINI_STREAM_CUTOFF = 4096;
const FREESECT = 0xffffffff;
const ENDOFCHAIN = 0xfffffffe;
const FATSECT = 0xfffffffd;
const NOSTREAM = 0xffffffff;

const enc = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);

// The OLE packaging ([MS-OLEDS] OLENativeStream's Packager spelling): header word, label, source path, 8 opaque bytes, temp path, then the file's size and bytes.
function packageStreamOf(
  fileBytes: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const zstring = (s: string): Uint8Array<ArrayBuffer> => enc(`${s}\0`);
  const parts = [
    new Uint8Array([0x02, 0x00]),
    zstring("Book1.xlsx"),
    zstring("C:\\data\\Book1.xlsx"),
    new Uint8Array(8),
    zstring("C:\\temp\\Book1.xlsx"),
    new Uint8Array(4),
    fileBytes,
  ];
  const out = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  new DataView(out.buffer).setUint32(
    out.length - fileBytes.length - 4,
    fileBytes.length,
    true,
  );
  return out;
}

function put16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function put32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
}

function writeEntry(
  entry: DataView,
  name: string,
  objectType: number,
  rightId: number,
  childId: number,
  startSector: number,
  size: number,
): void {
  const encoded = enc(name);
  for (let i = 0; i < encoded.length; i++) {
    entry.setUint8(i * 2, encoded[i] ?? 0);
    entry.setUint8(i * 2 + 1, 0);
  }
  put16(entry, 0x40, encoded.length * 2 + 2);
  entry.setUint8(0x42, objectType);
  put32(entry, 0x44, NOSTREAM);
  put32(entry, 0x48, rightId);
  put32(entry, 0x4c, childId);
  put32(entry, 0x74, startSector);
  put32(entry, 0x78, size);
  put32(entry, 0x7c, 0);
}

// Builds the .bin bytes: a version-3 compound file whose root storage carries the packaged file as its stream -- 'Package' by default, overridable for fixtures that need the no-Package-stream shape a native legacy embed produces. The stream is placed by the mini-stream cutoff exactly as a real producer would place it (below the cutoff in the mini stream, at or above it in its own FAT-chained sectors).
export function oleObjectBin(
  fileBytes: Uint8Array<ArrayBuffer>,
  options: { readonly streamName?: string } = {},
): Uint8Array<ArrayBuffer> {
  const packageStream = packageStreamOf(fileBytes);
  const small = packageStream.length < MINI_STREAM_CUTOFF;
  const padded = new Uint8Array(
    Math.ceil(packageStream.length / (small ? MINI_SECTOR_SIZE : SECTOR_SIZE)) *
      (small ? MINI_SECTOR_SIZE : SECTOR_SIZE),
  );
  padded.set(packageStream);
  const streamSectors = Math.ceil(padded.length / SECTOR_SIZE);
  const miniFatSector = 2 + streamSectors;
  const totalSectors = small ? miniFatSector + 1 : 2 + streamSectors;
  const file = new Uint8Array(SECTOR_SIZE + totalSectors * SECTOR_SIZE);
  const view = new DataView(file.buffer);

  // Header: the same field run every version-3 compound file carries (see archive-codec's reader).
  const magic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  for (let i = 0; i < magic.length; i++) {
    file[i] = magic[i] ?? 0;
  }
  put16(view, 0x18, 0x3e);
  put16(view, 0x1a, 3);
  put16(view, 0x1c, 0xfffe);
  put16(view, 0x1e, 9);
  put16(view, 0x20, 6);
  put32(view, 0x28, 0);
  put32(view, 0x2c, 1); // one FAT sector
  put32(view, 0x30, 1); // directory chain starts at sector 1
  put32(view, 0x38, MINI_STREAM_CUTOFF);
  put32(view, 0x3c, small ? miniFatSector : ENDOFCHAIN); // mini-FAT present only when the stream is mini-stream-resident
  put32(view, 0x40, small ? 1 : 0);
  put32(view, 0x44, ENDOFCHAIN);
  put32(view, 0x48, 0);
  put32(view, 0x4c, 0); // DIFAT[0]: the FAT is sector 0
  for (let i = 1; i < 109; i++) {
    put32(view, 0x4c + i * 4, FREESECT);
  }

  // Directory: root entry 0 (its stream IS the mini stream) and the Package stream as entry 1.
  const directory = new Uint8Array(SECTOR_SIZE);
  writeEntry(
    new DataView(directory.buffer, 0, 128),
    "Root Entry",
    5,
    NOSTREAM,
    1,
    small ? 2 : ENDOFCHAIN,
    small ? padded.length : 0,
  );
  writeEntry(
    new DataView(directory.buffer, 128, 128),
    options.streamName ?? "Package",
    2,
    NOSTREAM,
    NOSTREAM,
    small ? 0 : 2,
    packageStream.length,
  );

  // FAT: sector 0 holds the FAT itself, sector 1 the directory, sectors 2.. the stream's (or mini stream's) sectors, then the mini-FAT sector.
  const fatView = new DataView(file.buffer, SECTOR_SIZE, SECTOR_SIZE);
  fatView.setUint32(0, FATSECT, true);
  fatView.setUint32(4, ENDOFCHAIN, true);
  const streamStart = 2;
  for (let sector = streamStart; sector < 2 + streamSectors; sector++) {
    fatView.setUint32(
      sector * 4,
      sector === 1 + streamSectors ? ENDOFCHAIN : sector + 1,
      true,
    );
  }
  if (small) {
    fatView.setUint32(miniFatSector * 4, ENDOFCHAIN, true);
  }

  if (small) {
    // Mini-FAT: the stream's mini sectors chained then ENDOFCHAIN, FREESECT padding after.
    const miniFatView = new DataView(
      file.buffer,
      SECTOR_SIZE + miniFatSector * SECTOR_SIZE,
      SECTOR_SIZE,
    );
    const miniSectorCount = padded.length / MINI_SECTOR_SIZE;
    for (let i = 0; i < miniSectorCount; i++) {
      miniFatView.setUint32(
        i * 4,
        i === miniSectorCount - 1 ? ENDOFCHAIN : i + 1,
        true,
      );
    }
  }

  file.set(directory, SECTOR_SIZE + 1 * SECTOR_SIZE);
  file.set(padded, SECTOR_SIZE + streamStart * SECTOR_SIZE);
  return file;
}
