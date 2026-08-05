// Table-driven CRC32 (polynomial 0xEDB88320, the standard IEEE 802.3 / ZIP / PNG polynomial). fflate exports no CRC32 of its own (only an internal one used by its ZIP writer), and PNG's chunk format requires one per chunk, so this is genuinely new code, not a duplicate of anything already in the tree.
const CRC32_POLYNOMIAL = 0xedb88320;
const BYTE_VALUES = 256;
const BITS_PER_BYTE = 8;

const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(BYTE_VALUES);
  for (let n = 0; n < BYTE_VALUES; n++) {
    let c = n;
    for (let k = 0; k < BITS_PER_BYTE; k++) {
      c = (c & 1) === 1 ? CRC32_POLYNOMIAL ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array<ArrayBuffer>): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
