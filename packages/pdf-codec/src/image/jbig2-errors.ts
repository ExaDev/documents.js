// The two failure kinds every jbig2-*.ts module distinguishes, in their own module so the lowest layers (jbig2-bitmap.ts, jbig2-generic.ts) can throw them without importing the segment reader that sits above them.
//
// The split is the one this codec's own three-tier read policy already draws elsewhere: a stream that cannot be meaningfully processed at all is one thing, and a stream this decoder simply has not been taught to read is another. Both are reported to a PDF caller the same way -- src/filters.ts turns either into a diagnostic and leaves the image undecoded -- but a caller using src/image/jbig2.ts directly can tell "this file is broken" from "this file is fine, I just do not decode this part of the format yet".

// The bitstream stopped making sense: a segment declaring more data than it carries, a field outside the range its own specification table defines, a region composed before any page existed to compose it onto.
export class Jbig2ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Jbig2ParseError';
  }
}

// The stream is well-formed but uses a part of ITU-T T.88 this decoder does not implement. Always names the feature -- see the JBIG2 scope section of this package's README for the full list.
export class Jbig2UnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Jbig2UnsupportedError';
  }
}
