import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  // Every valid mutant is either killed or excluded via a justified Stryker disable comment (see crc32.ts/reader.ts/writer.ts/flate.ts/jpeg-info.ts/png-decode.ts/png-encode.ts/png-filter.ts for each one's equivalence proof), so the gate is the literal maximum rather than a derived-with-slack figure.
  breakThreshold: 100,
});
