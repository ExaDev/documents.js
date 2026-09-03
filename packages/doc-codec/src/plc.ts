import { readUint32LE, slice } from "./bytes";
import { DocFormatError } from "./errors";

// The PLC ("PLex of Cps"), [MS-DOC] 2.2.2 -- the one container shape that carries almost every mapping in the format: an array of 4-byte keys followed by an array of fixed-size data elements, with exactly one more key than element, so key[i] and key[i+1] bracket the range element i describes. The keys are character positions in PlcPcd and byte offsets in PlcBteChpx/PlcBtePapx ("Where most PLCs map CPs to data, the PlcBteChpx maps stream offsets to data instead"), but the layout and the element-count arithmetic are identical, so one parser serves both rather than each caller re-deriving the split point.
//
// The element count is not stored: it is derived from the PLC's total size, which is why every caller must pass a size the FIB declared rather than the whole stream. [MS-DOC] 2.2.2 gives the derivation directly -- n = (cbPlc - 4) / (4 + cbData), and "the preceding expression MUST yield a whole number for n". A size that does not is a corrupt file, not a variant, so it throws rather than rounding: rounding would silently shift every element's boundary and produce plausible-looking wrong text.

export interface Plc {
  /** The (count + 1) keys, ascending. keys[i] and keys[i + 1] bracket element i. */
  readonly keys: readonly number[];
  readonly count: number;
  /** The bytes of data element i, a view into the PLC's own bytes rather than a copy. */
  element(index: number): Uint8Array;
}

export function parsePlc(
  bytes: Uint8Array,
  elementSize: number,
  what: string,
): Plc {
  if (!Number.isInteger(elementSize) || elementSize < 0) {
    throw new DocFormatError(
      `${what} was parsed with an element size of ${elementSize}, which is not a non-negative integer`,
    );
  }
  if (bytes.length < 4) {
    throw new DocFormatError(
      `${what} is ${bytes.length} bytes, too short to hold even the single terminating CP every PLC ends with`,
    );
  }
  const count = (bytes.length - 4) / (4 + elementSize);
  if (!Number.isInteger(count)) {
    throw new DocFormatError(
      `${what} is ${bytes.length} bytes, which does not yield a whole number of ${elementSize}-byte data elements: (${bytes.length} - 4) / (4 + ${elementSize}) = ${count}`,
    );
  }

  const keys: number[] = [];
  for (let index = 0; index <= count; index += 1) {
    const key = readUint32LE(bytes, index * 4);
    const previous = keys[index - 1];
    // "The CPs MUST appear in ascending order" ([MS-DOC] 2.2.2). Enforced rather than assumed because every lookup below is a binary search that would return an arbitrary index on unsorted keys instead of failing -- the silent-wrong-answer case this package exists to avoid.
    if (previous !== undefined && key < previous) {
      throw new DocFormatError(
        `${what} key ${index} is ${key}, which is less than the preceding key ${previous}; a PLC's keys must be in ascending order`,
      );
    }
    keys.push(key);
  }

  const dataStart = (count + 1) * 4;
  return {
    keys,
    count,
    element(index: number): Uint8Array {
      if (!Number.isInteger(index) || index < 0 || index >= count) {
        throw new DocFormatError(
          `${what} has ${count} data elements; element ${index} was requested`,
        );
      }
      return slice(
        bytes,
        dataStart + index * elementSize,
        elementSize,
        `${what} element ${index}`,
      );
    },
  };
}

// "Find the largest i such that keys[i] <= value" -- the lookup [MS-DOC]'s Retrieving Text, Direct Character Formatting, and Determining Paragraph Boundaries algorithms each phrase in exactly those words. Returns undefined when the value falls outside the PLC's range, which every one of those algorithms treats as "cp is outside the range of character positions in this document, and is not valid": the last key is a terminator, never the start of a range, so a value at or past it has no element.
export function findLargestAtMost(
  keys: readonly number[],
  value: number,
): number | undefined {
  let low = 0;
  let high = keys.length - 1;
  let found: number | undefined;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const key = keys[middle];
    if (key === undefined) {
      throw new DocFormatError(
        `PLC key ${middle} is absent from a ${keys.length}-key array`,
      );
    }
    if (key <= value) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  // The final key terminates the last range rather than opening a new one, so landing on it means the value is past the end.
  return found === undefined || found >= keys.length - 1 ? undefined : found;
}
