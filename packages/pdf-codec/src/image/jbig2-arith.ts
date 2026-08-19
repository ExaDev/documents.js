// The MQ arithmetic decoder ITU-T T.88 Annex E specifies, plus the arithmetic integer and symbol-ID decoding procedures of Annex A that are built on top of it. This module has zero PDF and zero JBIG2-segment knowledge: it is the raw entropy layer every other jbig2-*.ts module drives.
//
// The MQ coder is a binary adaptive arithmetic coder shared verbatim with JPEG 2000 (ITU-T T.800 Annex C) and derived from the QM coder of JBIG1/JPEG. Every register name below (A, C, CT, BP) and every procedure name (INITDEC, DECODE, BYTEIN, MPS_EXCHANGE, LPS_EXCHANGE, RENORMD) is the specification's own, so each function body can be checked line for line against T.88 Figures E.15-E.20.

// T.88 Table E.1: the probability estimation state machine. Each row is (Qe, NMPS, NLPS, SWITCH) -- the LPS sub-interval size, the next state after an MPS renormalisation, the next state after an LPS renormalisation, and whether that LPS transition also swaps which symbol is the MPS.
const QE_STATES: readonly (readonly [number, number, number, number])[] = [
  [0x5601, 1, 1, 1],
  [0x3401, 2, 6, 0],
  [0x1801, 3, 9, 0],
  [0x0ac1, 4, 12, 0],
  [0x0521, 5, 29, 0],
  [0x0221, 38, 33, 0],
  [0x5601, 7, 6, 1],
  [0x5401, 8, 14, 0],
  [0x4801, 9, 14, 0],
  [0x3801, 10, 14, 0],
  [0x3001, 11, 17, 0],
  [0x2401, 12, 18, 0],
  [0x1c01, 13, 20, 0],
  [0x1601, 29, 21, 0],
  [0x5601, 15, 14, 1],
  [0x5401, 16, 14, 0],
  [0x5101, 17, 15, 0],
  [0x4801, 18, 16, 0],
  [0x3801, 19, 17, 0],
  [0x3401, 20, 18, 0],
  [0x3001, 21, 19, 0],
  [0x2801, 22, 19, 0],
  [0x2401, 23, 20, 0],
  [0x2201, 24, 21, 0],
  [0x1c01, 25, 22, 0],
  [0x1801, 26, 23, 0],
  [0x1601, 27, 24, 0],
  [0x1401, 28, 25, 0],
  [0x1201, 29, 26, 0],
  [0x1101, 30, 27, 0],
  [0x0ac1, 31, 28, 0],
  [0x09c1, 32, 29, 0],
  [0x08a1, 33, 30, 0],
  [0x0521, 34, 31, 0],
  [0x0441, 35, 32, 0],
  [0x02a1, 36, 33, 0],
  [0x0221, 37, 34, 0],
  [0x0141, 38, 35, 0],
  [0x0111, 39, 36, 0],
  [0x0085, 40, 37, 0],
  [0x0049, 41, 38, 0],
  [0x0025, 42, 39, 0],
  [0x0015, 43, 40, 0],
  [0x0009, 44, 41, 0],
  [0x0005, 45, 42, 0],
  [0x0001, 45, 43, 0],
  [0x5601, 46, 46, 0],
];

const QE_VALUE = Uint16Array.from(QE_STATES, (row) => row[0]);
const QE_NMPS = Uint8Array.from(QE_STATES, (row) => row[1]);
const QE_NLPS = Uint8Array.from(QE_STATES, (row) => row[2]);
const QE_SWITCH = Uint8Array.from(QE_STATES, (row) => row[3]);

// One adaptive context per array entry, packing the T.88 pair (I, MPS) -- the state-machine index and which binary symbol is currently the more probable one -- into a single byte as (I << 1) | MPS. Every context starts at state 0 with MPS 0, which is exactly what a zero-filled array already means, so no explicit reset pass is needed.
export type ArithContexts = Uint8Array<ArrayBuffer>;

export function createArithContexts(contextBits: number): ArithContexts {
  return new Uint8Array(1 << contextBits);
}

const A_INITIAL = 0x8000;
const C_INITIAL_SHIFT = 16;
const INITDEC_C_SHIFT = 7;

// Past the end of the coded data the decoder behaves as if 0xFF bytes follow (T.88 E.3.4's marker handling, which BYTEIN below reaches through the B == 0xFF / B1 > 0x8F branch). A real encoder's final bytes are chosen so this never changes the decoded result; a truncated or corrupt stream degrades into repeated decisions rather than reading outside the buffer.
const PAST_END_BYTE = 0xff;

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
    return index >= this.start && index < this.end ? (this.data[index] ?? PAST_END_BYTE) : PAST_END_BYTE;
  }

  // BYTEIN (T.88 Figure E.19). B is the byte at BP and B1 the byte after it; the 0xFF/>0x8F pair is the marker test that lets a decoder run past the end of the coded segment without consuming anything.
  private byteIn(): void {
    if (this.byteAt(this.bp) === 0xff) {
      if (this.byteAt(this.bp + 1) > 0x8f) {
        this.c = (this.c + 0xff00) >>> 0;
        this.ct = 8;
        return;
      }
      this.bp++;
      this.c = (this.c + (this.byteAt(this.bp) << 9)) >>> 0;
      this.ct = 7;
      return;
    }
    this.bp++;
    this.c = (this.c + (this.byteAt(this.bp) << 8)) >>> 0;
    this.ct = 8;
  }

  // RENORMD (T.88 Figure E.18).
  private renormalise(): void {
    do {
      if (this.ct === 0) {
        this.byteIn();
      }
      this.a = (this.a << 1) & 0xffff;
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
    if (this.c >>> 16 < qe) {
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
      this.c = (this.c - (qe << 16)) >>> 0;
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

// A.2's own value ranges: each successive prefix selects a wider suffix with a larger offset added to it.
const INTEGER_RANGES: readonly (readonly [number, number])[] = [
  [2, 0],
  [4, 4],
  [6, 20],
  [8, 84],
  [12, 340],
  [32, 4436],
];

// The out-of-band value A.2 step 5 defines (S = 1 with a zero magnitude), which several procedures use as a terminator rather than as a number. Modelled as `undefined` rather than a sentinel number so a caller cannot silently treat it as a real value.
export function decodeInteger(mq: MqDecoder, contexts: ArithContexts): number | undefined {
  let prev = 1;
  const nextBit = (): number => {
    const bit = mq.decode(contexts, prev);
    prev = prev < 256 ? (prev << 1) | bit : ((((prev << 1) | bit) & 511) | 256);
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
      const [bits, offset] = INTEGER_RANGES[i] ?? [0, 0];
      magnitude = readBits(bits) + offset;
      matched = true;
      break;
    }
  }
  if (!matched) {
    const [bits, offset] = INTEGER_RANGES[INTEGER_RANGES.length - 1] ?? [0, 0];
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

export function decodeSymbolId(mq: MqDecoder, contexts: ArithContexts, codeLength: number): number {
  let prev = 1;
  for (let i = 0; i < codeLength; i++) {
    prev = (prev << 1) | mq.decode(contexts, prev);
  }
  return prev - (1 << codeLength);
}
