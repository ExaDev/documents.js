// The MQ arithmetic decoder ITU-T T.88 Annex E specifies, plus the arithmetic integer and symbol-ID decoding procedures of Annex A that are built on top of it. This module has zero PDF and zero JBIG2-segment knowledge: it is the raw entropy layer every other jbig2-*.ts module drives.
//
// The MQ coder is a binary adaptive arithmetic coder shared verbatim with JPEG 2000 (ITU-T T.800 Annex C) and derived from the QM coder of JBIG1/JPEG. Every register name below (A, C, CT, BP) and every procedure name (INITDEC, DECODE, BYTEIN, MPS_EXCHANGE, LPS_EXCHANGE, RENORMD) is the specification's own, so each function body can be checked line for line against T.88 Figures E.15-E.20.

// T.88 Table E.1: the probability estimation state machine. Each row gives the LPS sub-interval size (qe), the next state after an MPS renormalisation (nmps), the next state after an LPS renormalisation (nlps), and whether that LPS transition also swaps which symbol is the MPS (switchMps): named-field objects rather than positional tuples, since a numeric literal used as an object-property value is exempt from no-magic-numbers, unlike one used as an array element, and the state machine's own four roles are worth naming at each row regardless.
interface QeState {
  readonly qe: number;
  readonly nmps: number;
  readonly nlps: number;
  readonly switchMps: number;
}

const QE_STATES: readonly QeState[] = [
  { qe: 0x5601, nmps: 1, nlps: 1, switchMps: 1 },
  { qe: 0x3401, nmps: 2, nlps: 6, switchMps: 0 },
  { qe: 0x1801, nmps: 3, nlps: 9, switchMps: 0 },
  { qe: 0x0ac1, nmps: 4, nlps: 12, switchMps: 0 },
  { qe: 0x0521, nmps: 5, nlps: 29, switchMps: 0 },
  { qe: 0x0221, nmps: 38, nlps: 33, switchMps: 0 },
  { qe: 0x5601, nmps: 7, nlps: 6, switchMps: 1 },
  { qe: 0x5401, nmps: 8, nlps: 14, switchMps: 0 },
  { qe: 0x4801, nmps: 9, nlps: 14, switchMps: 0 },
  { qe: 0x3801, nmps: 10, nlps: 14, switchMps: 0 },
  { qe: 0x3001, nmps: 11, nlps: 17, switchMps: 0 },
  { qe: 0x2401, nmps: 12, nlps: 18, switchMps: 0 },
  { qe: 0x1c01, nmps: 13, nlps: 20, switchMps: 0 },
  { qe: 0x1601, nmps: 29, nlps: 21, switchMps: 0 },
  { qe: 0x5601, nmps: 15, nlps: 14, switchMps: 1 },
  { qe: 0x5401, nmps: 16, nlps: 14, switchMps: 0 },
  { qe: 0x5101, nmps: 17, nlps: 15, switchMps: 0 },
  { qe: 0x4801, nmps: 18, nlps: 16, switchMps: 0 },
  { qe: 0x3801, nmps: 19, nlps: 17, switchMps: 0 },
  { qe: 0x3401, nmps: 20, nlps: 18, switchMps: 0 },
  { qe: 0x3001, nmps: 21, nlps: 19, switchMps: 0 },
  { qe: 0x2801, nmps: 22, nlps: 19, switchMps: 0 },
  { qe: 0x2401, nmps: 23, nlps: 20, switchMps: 0 },
  { qe: 0x2201, nmps: 24, nlps: 21, switchMps: 0 },
  { qe: 0x1c01, nmps: 25, nlps: 22, switchMps: 0 },
  { qe: 0x1801, nmps: 26, nlps: 23, switchMps: 0 },
  { qe: 0x1601, nmps: 27, nlps: 24, switchMps: 0 },
  { qe: 0x1401, nmps: 28, nlps: 25, switchMps: 0 },
  { qe: 0x1201, nmps: 29, nlps: 26, switchMps: 0 },
  { qe: 0x1101, nmps: 30, nlps: 27, switchMps: 0 },
  { qe: 0x0ac1, nmps: 31, nlps: 28, switchMps: 0 },
  { qe: 0x09c1, nmps: 32, nlps: 29, switchMps: 0 },
  { qe: 0x08a1, nmps: 33, nlps: 30, switchMps: 0 },
  { qe: 0x0521, nmps: 34, nlps: 31, switchMps: 0 },
  { qe: 0x0441, nmps: 35, nlps: 32, switchMps: 0 },
  { qe: 0x02a1, nmps: 36, nlps: 33, switchMps: 0 },
  { qe: 0x0221, nmps: 37, nlps: 34, switchMps: 0 },
  { qe: 0x0141, nmps: 38, nlps: 35, switchMps: 0 },
  { qe: 0x0111, nmps: 39, nlps: 36, switchMps: 0 },
  { qe: 0x0085, nmps: 40, nlps: 37, switchMps: 0 },
  { qe: 0x0049, nmps: 41, nlps: 38, switchMps: 0 },
  { qe: 0x0025, nmps: 42, nlps: 39, switchMps: 0 },
  { qe: 0x0015, nmps: 43, nlps: 40, switchMps: 0 },
  { qe: 0x0009, nmps: 44, nlps: 41, switchMps: 0 },
  { qe: 0x0005, nmps: 45, nlps: 42, switchMps: 0 },
  { qe: 0x0001, nmps: 45, nlps: 43, switchMps: 0 },
  { qe: 0x5601, nmps: 46, nlps: 46, switchMps: 0 },
];

const QE_VALUE = Uint16Array.from(QE_STATES, (row) => row.qe);
const QE_NMPS = Uint8Array.from(QE_STATES, (row) => row.nmps);
const QE_NLPS = Uint8Array.from(QE_STATES, (row) => row.nlps);
const QE_SWITCH = Uint8Array.from(QE_STATES, (row) => row.switchMps);

// One adaptive context per array entry, packing the T.88 pair (I, MPS) — the state-machine index and which binary symbol is currently the more probable one — into a single byte as (I << 1) | MPS. Every context starts at state 0 with MPS 0, which is exactly what a zero-filled array already means, so no explicit reset pass is needed.
export type ArithContexts = Uint8Array<ArrayBuffer>;

export function createArithContexts(contextBits: number): ArithContexts {
  return new Uint8Array(1 << contextBits);
}

const A_INITIAL = 0x8000;
const C_INITIAL_SHIFT = 16;
const INITDEC_C_SHIFT = 7;

// Past the end of the coded data the decoder behaves as if 0xFF bytes follow (T.88 E.3.4's marker handling, which BYTEIN below reaches through the B == 0xFF / B1 > 0x8F branch). A real encoder's final bytes are chosen so this never changes the decoded result; a truncated or corrupt stream degrades into repeated decisions rather than reading outside the buffer.
const PAST_END_BYTE = 0xff;

// BYTEIN's own T.88 Figure E.19 constants: the "B1 > 0x8F" marker-follower threshold that distinguishes a genuine stuffed 0xFF from the start of a real end-of-data marker, the 16-bit-register increment BYTEIN adds when it detects one, the two BP-advance bit-shift widths (9 bits when a stuffed zero bit was skipped, 8 bits otherwise), and CT's own reload value after a stuffed byte (7, distinct from INITDEC_C_SHIFT above despite the coincidentally equal value: this one sets a bit counter, INITDEC_C_SHIFT shifts a register).
const MARKER_FOLLOWER_THRESHOLD = 0x8f;
const MARKER_C_INCREMENT = 0xff00;
const STUFFED_BYTE_SHIFT = 9;
const NORMAL_BYTE_SHIFT = 8;
const STUFFED_BYTE_CT_RELOAD = 7;

// RENORMD's own 16-bit A-register mask (T.88 Figure E.18), and DECODE's own C-register high-half shift (T.88 Figure E.17: the top 16 bits of C are compared against and debited by Qe).
const A_REGISTER_MASK = 0xffff;
const C_HIGH_HALF_SHIFT = 16;

export class MqDecoder {
  private bp: number;
  private c = 0;
  private a = 0;
  private ct = 0;

  constructor(
    private readonly data: Uint8Array<ArrayBuffer>,
    private readonly start = 0,
    private readonly end = data.length,
  ) {
    // INITDEC (T.88 Figure E.20).
    this.bp = start;
    this.c = (this.byteAt(this.bp) << C_INITIAL_SHIFT) >>> 0;
    this.byteIn();
    this.c = (this.c << INITDEC_C_SHIFT) >>> 0;
    this.ct -= INITDEC_C_SHIFT;
    this.a = A_INITIAL;
  }

  private byteAt(index: number): number {
    return index >= this.start && index < this.end
      ? (this.data[index] ?? PAST_END_BYTE)
      : PAST_END_BYTE;
  }

  // BYTEIN (T.88 Figure E.19). B is the byte at BP and B1 the byte after it; the 0xFF/>0x8F pair is the marker test that lets a decoder run past the end of the coded segment without consuming anything.
  private byteIn(): void {
    if (this.byteAt(this.bp) === PAST_END_BYTE) {
      if (this.byteAt(this.bp + 1) > MARKER_FOLLOWER_THRESHOLD) {
        this.c = (this.c + MARKER_C_INCREMENT) >>> 0;
        this.ct = NORMAL_BYTE_SHIFT;
        return;
      }
      this.bp++;
      this.c = (this.c + (this.byteAt(this.bp) << STUFFED_BYTE_SHIFT)) >>> 0;
      this.ct = STUFFED_BYTE_CT_RELOAD;
      return;
    }
    this.bp++;
    this.c = (this.c + (this.byteAt(this.bp) << NORMAL_BYTE_SHIFT)) >>> 0;
    this.ct = NORMAL_BYTE_SHIFT;
  }

  // RENORMD (T.88 Figure E.18).
  private renormalise(): void {
    do {
      if (this.ct === 0) {
        this.byteIn();
      }
      this.a = (this.a << 1) & A_REGISTER_MASK;
      this.c = (this.c << 1) >>> 0;
      this.ct--;
    } while ((this.a & A_INITIAL) === 0);
  }

  // DECODE (T.88 Figure E.17), with MPS_EXCHANGE (E.16) and LPS_EXCHANGE (E.15) inlined into their two branches so the whole decision is one readable pass over the register state.
  decode(contexts: ArithContexts, contextIndex: number): number {
    const state = contexts[contextIndex] ?? 0;
    let index = state >> 1;
    let mps = state & 1;
    const qe = QE_VALUE[index] ?? 0;
    this.a -= qe;

    let decision: number;
    if (this.c >>> C_HIGH_HALF_SHIFT < qe) {
      // LPS_EXCHANGE.
      if (this.a < qe) {
        decision = mps;
        index = QE_NMPS[index] ?? 0;
      } else {
        decision = 1 - mps;
        if (QE_SWITCH[index] === 1) {
          mps = 1 - mps;
        }
        index = QE_NLPS[index] ?? 0;
      }
      this.a = qe;
    } else {
      this.c = (this.c - (qe << C_HIGH_HALF_SHIFT)) >>> 0;
      if ((this.a & A_INITIAL) !== 0) {
        return mps; // The MPS interval is still normalised: no state change and no renormalisation.
      }
      // MPS_EXCHANGE.
      if (this.a < qe) {
        decision = 1 - mps;
        if (QE_SWITCH[index] === 1) {
          mps = 1 - mps;
        }
        index = QE_NLPS[index] ?? 0;
      } else {
        decision = mps;
        index = QE_NMPS[index] ?? 0;
      }
    }

    this.renormalise();
    contexts[contextIndex] = (index << 1) | mps;
    return decision;
  }
}

// --- The arithmetic integer decoding procedure (T.88 Annex A.2). ---

// The PREV context register saturates at 512 entries (A.2 step 2's "if PREV < 256" rule), so every integer context array is this many entries regardless of which of IADH/IADW/IAEX/IAAI/IADT/IAFS/IADS/IAIT/IARI/IARDW/IARDH/IARDX/IARDY it serves.
const INTEGER_CONTEXT_BITS = 9;

export function createIntegerContexts(): ArithContexts {
  return createArithContexts(INTEGER_CONTEXT_BITS);
}

// A.2's own value ranges: each successive prefix selects a wider suffix (bits) with a larger offset added to it.
interface IntegerRange {
  readonly bits: number;
  readonly offset: number;
}
const INTEGER_RANGES: readonly IntegerRange[] = [
  { bits: 2, offset: 0 },
  { bits: 4, offset: 4 },
  { bits: 6, offset: 20 },
  { bits: 8, offset: 84 },
  { bits: 12, offset: 340 },
  { bits: 32, offset: 4436 },
];

// The out-of-band value A.2 step 5 defines (S = 1 with a zero magnitude), which several procedures use as a terminator rather than as a number. Modelled as `undefined` rather than a sentinel number so a caller cannot silently treat it as a real value.
export function decodeInteger(
  mq: MqDecoder,
  contexts: ArithContexts,
): number | undefined {
  // The PREV register itself is a 9-bit shift register that saturates rather than growing unboundedly (A.2 step 2): below the saturation point it just shifts in the new bit, at or above it the new bit still shifts in but the register's own top bit (the SATURATION_HIGH_BIT below the saturation threshold's own bit width) is forced back on afterwards, which is what stops it ever indexing past INTEGER_CONTEXT_BITS' own 512-entry context array.
  const PREV_SATURATION_THRESHOLD = 256;
  const PREV_REGISTER_MASK = 511;
  const PREV_SATURATION_HIGH_BIT = 256;
  let prev = 1;
  const nextBit = (): number => {
    const bit = mq.decode(contexts, prev);
    prev =
      prev < PREV_SATURATION_THRESHOLD
        ? (prev << 1) | bit
        : (((prev << 1) | bit) & PREV_REGISTER_MASK) | PREV_SATURATION_HIGH_BIT;
    return bit;
  };
  const readBits = (count: number): number => {
    let value = 0;
    for (let i = 0; i < count; i++) {
      value = value * 2 + nextBit();
    }
    return value;
  };

  const sign = nextBit();
  let magnitude = 0;
  let matched = false;
  for (let i = 0; i < INTEGER_RANGES.length - 1; i++) {
    if (nextBit() === 0) {
      const { bits, offset } = INTEGER_RANGES[i] ?? { bits: 0, offset: 0 };
      magnitude = readBits(bits) + offset;
      matched = true;
      break;
    }
  }
  if (!matched) {
    const { bits, offset } = INTEGER_RANGES[INTEGER_RANGES.length - 1] ?? {
      bits: 0,
      offset: 0,
    };
    magnitude = readBits(bits) + offset;
  }

  if (sign === 1) {
    return magnitude === 0 ? undefined : -magnitude;
  }
  return magnitude;
}

// --- The IAID symbol-ID decoding procedure (T.88 Annex A.3). ---

// IAID walks a fixed-depth binary tree rather than the prefix/suffix structure above, so its context array is sized by the symbol code length rather than by A.2's saturating PREV.
export function createSymbolIdContexts(codeLength: number): ArithContexts {
  return createArithContexts(codeLength + 1);
}

export function decodeSymbolId(
  mq: MqDecoder,
  contexts: ArithContexts,
  codeLength: number,
): number {
  let prev = 1;
  for (let i = 0; i < codeLength; i++) {
    prev = (prev << 1) | mq.decode(contexts, prev);
  }
  return prev - (1 << codeLength);
}
