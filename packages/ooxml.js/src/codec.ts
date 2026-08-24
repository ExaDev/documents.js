import { z } from "zod";
import { type Package, PackageSchema } from "./model/package";
import { XmlNodeSchema } from "./model/node";
import { parsePackage } from "./package-io/read";
import { serializePackage } from "./package-io/write";
import { parseXml } from "./xml/parse";
import { buildXml } from "./xml/build";

// XML string <-> ordered XmlNode forest. Both directions are schema-validated.
export const xmlCodec = z.codec(z.string(), z.array(XmlNodeSchema), {
  decode: (xml) => parseXml(xml),
  encode: (nodes) => buildXml(nodes),
});

// OOXML package bytes <-> faithful JSON Package. The core round-trip codec.
export const packageCodec = z.codec(z.instanceof(Uint8Array), PackageSchema, {
  decode: (bytes) => parsePackage(bytes),
  encode: (pkg) => serializePackage(pkg),
});

export function decodePackage(bytes: Uint8Array<ArrayBuffer>): Package {
  return z.decode(packageCodec, bytes);
}

export function encodePackage(pkg: Package): Uint8Array<ArrayBuffer> {
  return z.encode(packageCodec, pkg);
}
