import { decodeStream } from "../filters";
import type { PdfObjectResolver } from "../interpret-types";

/**
 * A full `PdfObjectResolver` over a test's own `resolve` and `resolveDict`, decoding with no budget: what a document opened without `maxDecodedBytes` does, for a test that builds its objects by hand rather than opening a file.
 * @param base - the test's reference-following functions
 * @returns the resolver, its decodeStream following references through `base.resolve` and its chargeDecodedBytes charging nothing
 */
export function unbudgetedResolver(
  base: Readonly<Pick<PdfObjectResolver, "resolve" | "resolveDict">>,
): PdfObjectResolver {
  return {
    resolve: base.resolve,
    resolveDict: base.resolveDict,
    decodeStream: (stream, sink) =>
      decodeStream(stream.raw, stream.dict, sink, { resolve: base.resolve }),
    chargeDecodedBytes: () => undefined,
  };
}
