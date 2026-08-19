import { describe, expect, it } from 'vitest';
import { sha256, sha384, sha512 } from './sha2';

// FIPS 180-4's own published example vectors (and the NIST "Examples" appendix ones for the multi-block cases). These check the round-constant tables above all: SHA-256's constants are derived here from SHA-512's own table rather than transcribed separately, so a single wrong entry would break both hashes at once and show up in every vector below.

function hex(bytes: Uint8Array<ArrayBuffer>): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const ABC = 'abc';
// FIPS 180-4's own two-block example message for the 512-bit family.
const TWO_BLOCK = 'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu';
// FIPS 180-4's own two-block example message for the 256-bit family.
const TWO_BLOCK_256 = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';

function digest(hash: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>, text: string): string {
  return hex(hash(new TextEncoder().encode(text)));
}

describe('sha256', () => {
  it('matches FIPS 180-4 for "abc"', () => {
    expect(digest(sha256, ABC)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('matches FIPS 180-4 for the empty message', () => {
    expect(digest(sha256, '')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('matches FIPS 180-4 for a message spanning two blocks', () => {
    expect(digest(sha256, TWO_BLOCK_256)).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  // 55/56/57 bytes bracket the point where the 8-byte length field stops fitting in the same block as the 0x80 terminator.
  it('pads correctly either side of the 56-byte block boundary', () => {
    expect(digest(sha256, 'a'.repeat(55))).toBe('9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318');
    expect(digest(sha256, 'a'.repeat(56))).toBe('b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a');
    expect(digest(sha256, 'a'.repeat(57))).toBe('f13b2d724659eb3bf47f2dd6af1accc87b81f09f59f2b75e5c0bed6589dfe8c6');
  });
});

describe('sha384', () => {
  it('matches FIPS 180-4 for "abc"', () => {
    expect(digest(sha384, ABC)).toBe('cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7');
  });

  it('matches FIPS 180-4 for a message spanning two blocks', () => {
    expect(digest(sha384, TWO_BLOCK)).toBe('09330c33f71147e83d192fc782cd1b4753111b173b3b05d22fa08086e3b0f712fcc7c71a557e2db966c3e9fa91746039');
  });

  it('truncates to 48 bytes', () => {
    expect(sha384(new Uint8Array(0))).toHaveLength(48);
  });
});

describe('sha512', () => {
  it('matches FIPS 180-4 for "abc"', () => {
    expect(digest(sha512, ABC)).toBe('ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f');
  });

  it('matches FIPS 180-4 for a message spanning two blocks', () => {
    expect(digest(sha512, TWO_BLOCK)).toBe('8e959b75dae313da8cf4f72814fc143f8f7779c6eb9f7fa17299aeadb6889018501d289e4900f7e4331b99dec4b5433ac7d329eeb6dd26545e96e55b874be909');
  });

  // The 512-bit family uses 128-byte blocks and a 16-byte length field, so its own padding boundary sits at 112, not 56.
  it('pads correctly either side of the 112-byte block boundary', () => {
    expect(digest(sha512, 'a'.repeat(111))).toBe(
      'fa9121c7b32b9e01733d034cfc78cbf67f926c7ed83e82200ef86818196921760b4beff48404df811b953828274461673c68d04e297b0eb7b2b4d60fc6b566a2',
    );
    expect(digest(sha512, 'a'.repeat(112))).toBe(
      'c01d080efd492776a1c43bd23dd99d0a2e626d481e16782e75d54c2503b5dc32bd05f0f1ba33e568b88fd2d970929b719ecbb152f58f130a407c8830604b70ca',
    );
    expect(digest(sha512, 'a'.repeat(113))).toBe(
      '55ddd8ac210a6e18ba1ee055af84c966e0dbff091c43580ae1be703bdb85da31acf6948cf5bd90c55a20e5450f22fb89bd8d0085e39f85a86cc46abbca75e24d',
    );
  });
});
