// The two failure kinds every jpeg2000-*.ts module distinguishes, in their own module so the lowest layers (the tag-tree and tier-1 decoders) can throw them without importing the codestream reader that sits above them. Exactly the split src/image/jbig2-errors.ts already draws, for the same reason: "this file is broken" and "this file is fine, I just do not decode this part of the format" are different things to a caller, even though a PDF caller degrades both the same way.

// The codestream stopped making sense: a marker segment whose declared length does not match its contents, a field outside the range its own specification table defines, a packet header that ran past the end of its own data.
export class Jpeg2000ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Jpeg2000ParseError';
  }
}

// The codestream is well-formed but uses a part of ISO/IEC 15444-1 this decoder does not implement. Always names the feature -- see this package's README for the full list of what the JPEG 2000 decoder does and does not decode.
export class Jpeg2000UnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Jpeg2000UnsupportedError';
  }
}
