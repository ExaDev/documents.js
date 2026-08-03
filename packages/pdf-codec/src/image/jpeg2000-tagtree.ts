import { Jpeg2000ParseError } from './jpeg2000-errors';

// The two bit-level primitives a JPEG 2000 packet header is built from: the stuffed-bit reader of ISO/IEC 15444-1 B.10.1 and the tag tree of B.10.2. Both are pure bitstream mechanics with no knowledge of what the values mean, which is why they sit below jpeg2000-t2.ts rather than inside it.

// B.10.1: packet header bits are read most-significant first, and a byte that follows a 0xFF byte carries only seven bits -- its most significant bit is a stuffed zero, there so no 0xFF 0x90-or-above marker sequence can ever appear inside a packet header.
export class PacketBitReader {
  private position: number;
  private buffer = 0;
  private available = 0;
  private previousByte = 0;

  constructor(
    private readonly data: Uint8Array<ArrayBuffer>,
    start: number,
    private readonly end: number,
  ) {
    this.position = start;
  }

  get offset(): number {
    return this.position;
  }

  private nextByte(): number {
    if (this.position >= this.end) {
      // Past the end of the packet header the reader yields zero bits rather than throwing: a header truncated by a clipped stream should degrade into "nothing more was coded", which is exactly what a run of zero bits decodes as.
      this.previousByte = 0;
      return 0;
    }
    const byte = this.data[this.position] ?? 0;
    this.position++;
    return byte;
  }

  readBit(): number {
    if (this.available === 0) {
      const stuffed = this.previousByte === 0xff;
      const byte = this.nextByte();
      if (stuffed && (byte & 0x80) !== 0) {
        throw new Jpeg2000ParseError('a packet header byte following 0xFF has its stuffed bit set, which ISO/IEC 15444-1 B.10.1 forbids');
      }
      this.buffer = byte;
      this.previousByte = byte;
      this.available = stuffed ? 7 : 8;
    }
    this.available--;
    return (this.buffer >> this.available) & 1;
  }

  readBits(count: number): number {
    let value = 0;
    for (let i = 0; i < count; i++) {
      value = value * 2 + this.readBit();
    }
    return value;
  }

  // B.10.1: at the end of a packet header the reader discards the remaining bits of the current byte, and one further byte when the last byte consumed was 0xFF (that byte's stuffed successor belongs to the header, not to the body).
  alignToByte(): void {
    if (this.previousByte === 0xff) {
      this.nextByte();
    }
    this.available = 0;
    this.previousByte = 0;
  }
}

// B.10.2: a tag tree codes a 2D array of non-negative integers as a quadtree of partial sums, so a value shared by a whole region is transmitted once at the level that covers it. Leaves are the array itself; each level up halves both dimensions (rounding up) until a single root node remains.
//
// `value` starts at a sentinel above any threshold ever used, meaning "not yet determined"; `low` is the lower bound established so far, which persists between calls because a later layer's decode resumes from where an earlier one stopped.
export class TagTree {
  private readonly levelOffsets: number[] = [];
  private readonly levelWidths: number[] = [];
  private readonly levelHeights: number[] = [];
  private readonly value: Int32Array;
  private readonly low: Int32Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    let w = Math.max(width, 1);
    let h = Math.max(height, 1);
    let total = 0;
    for (;;) {
      this.levelOffsets.push(total);
      this.levelWidths.push(w);
      this.levelHeights.push(h);
      total += w * h;
      if (w === 1 && h === 1) {
        break;
      }
      w = Math.ceil(w / 2);
      h = Math.ceil(h / 2);
    }
    this.value = new Int32Array(total).fill(SENTINEL_VALUE);
    this.low = new Int32Array(total);
  }

  // Decodes whether the leaf at (x, y) holds a value strictly below `threshold`, consuming exactly as many bits as the encoder wrote for that question. Returning false leaves the leaf undetermined -- a later call with a higher threshold resumes from the same partial state, which is how inclusion information is spread across quality layers.
  decode(reader: PacketBitReader, x: number, y: number, threshold: number): boolean {
    const path: number[] = [];
    let levelX = x;
    let levelY = y;
    for (let level = 0; level < this.levelOffsets.length; level++) {
      path.push((this.levelOffsets[level] ?? 0) + levelY * (this.levelWidths[level] ?? 1) + levelX);
      levelX = levelX >> 1;
      levelY = levelY >> 1;
    }

    let low = 0;
    for (let i = path.length - 1; i >= 0; i--) {
      const node = path[i] ?? 0;
      if (low > (this.low[node] ?? 0)) {
        this.low[node] = low;
      } else {
        low = this.low[node] ?? 0;
      }
      while (low < threshold && low < (this.value[node] ?? SENTINEL_VALUE)) {
        if (reader.readBit() === 1) {
          this.value[node] = low;
        } else {
          low++;
        }
      }
      this.low[node] = low;
    }
    const leaf = path[0] ?? 0;
    return (this.value[leaf] ?? SENTINEL_VALUE) < threshold;
  }

  // The determined value of a leaf, valid only once decode() has returned true for it.
  valueAt(x: number, y: number): number {
    return this.value[y * (this.levelWidths[0] ?? 1) + x] ?? SENTINEL_VALUE;
  }
}

// Higher than any threshold a real packet header uses (thresholds are layer indices and zero-bit-plane counts, both bounded well below this), so an undetermined node always compares as "at least the threshold".
const SENTINEL_VALUE = 0x7fffffff;
