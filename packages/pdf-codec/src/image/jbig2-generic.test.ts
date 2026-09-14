import { describe, expect, it } from "vitest";
import { createArithContexts, MqDecoder } from "./jbig2-arith";
import { Jbig2UnsupportedError } from "./jbig2-errors";
import { decodeGenericRegion, decodeRefinementRegion } from "./jbig2-generic";

// decodeGenericRegion/decodeRefinementRegion are exported, so their own template guard is part of their public contract, even though jbig2.ts's own segment parser always masks GBTEMPLATE/GRTEMPLATE to a range GENERIC_TEMPLATES/REFINEMENT_TEMPLATES already cover -- a direct caller (or a future one) is not bound by that masking.
function dummyDecoder(): MqDecoder {
  return new MqDecoder(new Uint8Array(0));
}

describe("decodeGenericRegion template validation", () => {
  it("refuses a GBTEMPLATE outside the 0-3 range T.88 6.2.5.3 defines", () => {
    expect(() =>
      decodeGenericRegion(
        1,
        1,
        { template: 4, tpgdon: false, at: [] },
        dummyDecoder(),
        createArithContexts(16),
      ),
    ).toThrow(Jbig2UnsupportedError);
    expect(() =>
      decodeGenericRegion(
        1,
        1,
        { template: 4, tpgdon: false, at: [] },
        dummyDecoder(),
        createArithContexts(16),
      ),
    ).toThrow(/GBTEMPLATE 4/);
  });
});

describe("decodeRefinementRegion template validation", () => {
  it("refuses a GRTEMPLATE outside the 0-1 range T.88 6.3.5.3 defines", () => {
    const reference = { width: 1, height: 1, data: new Uint8Array(1) };
    expect(() =>
      decodeRefinementRegion(
        1,
        1,
        {
          template: 2,
          tpgron: false,
          at: [],
          reference,
          dx: 0,
          dy: 0,
        },
        dummyDecoder(),
        createArithContexts(13),
      ),
    ).toThrow(Jbig2UnsupportedError);
    expect(() =>
      decodeRefinementRegion(
        1,
        1,
        {
          template: 2,
          tpgron: false,
          at: [],
          reference,
          dx: 0,
          dy: 0,
        },
        dummyDecoder(),
        createArithContexts(13),
      ),
    ).toThrow(/GRTEMPLATE 2/);
  });
});
