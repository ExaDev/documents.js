import { describe, expect, it } from 'vitest';
import { probeCff } from './cff-probe';
import { CFF_HEADER, ROS_OPERANDS_AND_OPERATOR, cffFont, cffIndex, stixMathCffBytes } from './test-support/cff';

// The real, vendored STIX Two Math font's own 'CFF ' table is genuine CFF data -- 691 KB of it, produced by a real font toolchain, not a fixture written to satisfy this parser -- so the header/INDEX/DICT walk is exercised against a real file first, and the hand-built fixtures (see test-support/cff.ts, shared with cff-bounds.test.ts) only cover the shapes that font does not happen to contain (a CID-keyed Top DICT, and the malformed cases).

describe('probeCff against the real vendored STIX Two Math CFF table', () => {
  it('reads the header, Name INDEX, and Top DICT of a genuine 691 KB CFF program', () => {
    const probe = probeCff(stixMathCffBytes());
    expect(probe).toEqual({ majorVersion: 1, minorVersion: 0, name: 'STIXTwoMath', cidKeyed: false });
  });

  it('reports the font as NOT CID-keyed, which is what makes CID == GID safe for it', () => {
    // The load-bearing assertion for math-font-write.ts's own existing embedding: STIX Two Math's Top DICT carries no ROS operator, so its CIDs index the CharStrings INDEX by glyph order and Identity-H text-showing needs no remapping (see math-font.ts's own module comment). A probe that answered "CID-keyed" here would be claiming the embedded math font this package already ships renders the wrong glyphs.
    expect(probeCff(stixMathCffBytes())?.cidKeyed).toBe(false);
  });
});

describe('probeCff CID-keyed detection', () => {
  it('detects the ROS operator in a Top DICT', () => {
    const probe = probeCff(cffFont('TestCIDFont', ROS_OPERANDS_AND_OPERATOR));
    expect(probe).toEqual({ majorVersion: 1, minorVersion: 0, name: 'TestCIDFont', cidKeyed: true });
  });

  it('detects ROS after other operators and operand kinds have been skipped', () => {
    // version (operator 0), CharStrings (operator 17, a 32-bit operand), and a real-number operand ahead of the ROS -- each a different operand length this walk has to get right to still land on the escaped operator.
    const topDict = [139, 0, 29, 0x00, 0x00, 0x01, 0x00, 17, 30, 0x0a, 0x00, 0x1f, 12, 7, ...ROS_OPERANDS_AND_OPERATOR];
    expect(probeCff(cffFont('AfterOperands', topDict))?.cidKeyed).toBe(true);
  });

  it('does not mistake the bytes INSIDE a real-number operand for the ROS operator', () => {
    // A real number's nibble stream here is 0x0c 0x1e -- the bytes 12 and 30, adjacent, exactly the escaped-operator pattern. A walk that did not know operand 30 introduces a variable-length nibble stream would read those two bytes as the ROS operator and wrongly refuse a perfectly embeddable font.
    const topDict = [30, 0x0c, 0x1e, 0xff, 139, 0];
    expect(probeCff(cffFont('RealNumberTrap', topDict))?.cidKeyed).toBe(false);
  });

  it('reports a plain, non-CID Top DICT as not CID-keyed', () => {
    const topDict = [139, 0, 250, 0x00, 12, 0, 29, 0x00, 0x00, 0x01, 0x00, 17];
    expect(probeCff(cffFont('PlainFont', topDict))?.cidKeyed).toBe(false);
  });
});

describe('CFF programs probeCff refuses to read', () => {
  it('returns undefined for a truncated header', () => {
    expect(probeCff(new Uint8Array([1, 0]))).toBeUndefined();
  });

  it('returns undefined for CFF2, whose header and INDEX layout are incompatible', () => {
    expect(probeCff(cffFont('Cff2Font', [139, 0], [2, 0, 5, 1]))).toBeUndefined();
  });

  it('returns undefined for a header declaring a size smaller than a header can be', () => {
    expect(probeCff(cffFont('ShortHeader', [139, 0], [1, 0, 2, 1]))).toBeUndefined();
  });

  it('returns undefined for an empty Name INDEX, which declares a FontSet holding no font', () => {
    expect(probeCff(new Uint8Array([...CFF_HEADER, ...cffIndex([]), ...cffIndex([[139, 0]])]))).toBeUndefined();
  });

  it('returns undefined for an empty Top DICT INDEX', () => {
    expect(probeCff(new Uint8Array([...CFF_HEADER, ...cffIndex([[0x41]]), ...cffIndex([])]))).toBeUndefined();
  });

  it('returns undefined for a Top DICT INDEX truncated mid-offset-array', () => {
    const bytes = new Uint8Array([...CFF_HEADER, ...cffIndex([[0x41]]), 0x00, 0x01, 0x01, 0x01]);
    expect(probeCff(bytes)).toBeUndefined();
  });

  it('returns undefined for a reserved DICT byte, which appears in no valid DICT', () => {
    for (const reserved of [22, 23, 24, 25, 26, 27, 31, 255]) {
      expect(probeCff(cffFont('Reserved', [139, 0, reserved]))).toBeUndefined();
    }
  });

  it('returns undefined for an escape byte with no operator byte after it', () => {
    expect(probeCff(cffFont('DanglingEscape', [139, 0, 12]))).toBeUndefined();
  });

  it('returns undefined for an integer operand running off the end of the DICT', () => {
    expect(probeCff(cffFont('TruncatedInt16', [28, 0x01]))).toBeUndefined();
    expect(probeCff(cffFont('TruncatedInt32', [29, 0x00, 0x00]))).toBeUndefined();
    expect(probeCff(cffFont('TruncatedMedium', [247]))).toBeUndefined();
  });

  it('returns undefined for a real-number operand with no terminating nibble', () => {
    expect(probeCff(cffFont('UnterminatedReal', [30, 0x12, 0x34]))).toBeUndefined();
  });
});
