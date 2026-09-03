import type { DocumentTree } from "document-schema.js";
import type { Package } from "../model/package";
import { transformOoo1Package } from "./transform";
import {
  readOdt,
  readOdtContent,
  type OdtDocument,
  type OdtReadOptions,
} from "../typed/odt/read";
import { readOds, readOdsContent, type OdsDocument } from "../typed/ods/read";
import { readOdp, readOdpContent, type OdpDocument } from "../typed/odp/read";
import { readOdg, readOdgContent, type OdgDocument } from "../typed/odg/read";

// The OpenOffice.org 1.x / StarOffice 6-7 readers: .sxw (Writer), .sxc (Calc), .sxi (Impress) and .sxd (Draw), plus their .stw/.stc/.sti/.std template counterparts, which differ from the documents only in their manifest media type and so read through the same function.
//
// Each is its ODF counterpart run over a transformed package, not a second reader: ./transform.ts rewrites the package into the ODF shape and readOdt/readOds/readOdp/readOdg do the actual reading. That is the whole point of treating OpenOffice.org XML as a variant of ODF rather than as a separate format -- every construct the ODF readers understand (the fidelity construct vocabulary in readOdt, the repeat-count cursor in readOds, the paint-order resolution in readOdg) works on an OpenOffice.org 1.x document for free, and a fix to any of them fixes both formats at once.
//
// Each format has the same two levels its ODF counterpart has: the bare name returns document-schema.js's DocumentTree, and the *Content sibling beneath it returns the flat ContentDocument-level shape. See this package's README for the distinction.
//
// What these readers do NOT do is write. Their own writing counterpart lives in write.ts (writeSxw/writeSxwContent, writeSxc/writeSxcContent), built on transform.ts's own inverse direction and this package's ODF-native writers (writeOdt, writeOds) -- .sxi/.sxd have no writer yet, since odf.js has no writeOdp/writeOdg for their own inverse transform to target.

// A .sxw or .stw (OpenOffice.org 1.x Writer) package as a flat OdtDocument.
export function readSxwContent(
  pkg: Package,
  options: OdtReadOptions = {},
): OdtDocument {
  return readOdtContent(transformOoo1Package(pkg), options);
}

// A .sxw or .stw package as a wordprocessing DocumentTree.
export function readSxw(
  pkg: Package,
  options: OdtReadOptions = {},
): DocumentTree {
  return readOdt(transformOoo1Package(pkg), options);
}

// A .sxc or .stc (OpenOffice.org 1.x Calc) package as a flat OdsDocument.
export function readSxcContent(pkg: Package): OdsDocument {
  return readOdsContent(transformOoo1Package(pkg));
}

// A .sxc or .stc package as a spreadsheet DocumentTree.
export function readSxc(pkg: Package): DocumentTree {
  return readOds(transformOoo1Package(pkg));
}

// A .sxi or .sti (OpenOffice.org 1.x Impress) package as a flat OdpDocument.
export function readSxiContent(pkg: Package): OdpDocument {
  return readOdpContent(transformOoo1Package(pkg));
}

// A .sxi or .sti package as a presentation DocumentTree.
export function readSxi(pkg: Package): DocumentTree {
  return readOdp(transformOoo1Package(pkg));
}

// A .sxd or .std (OpenOffice.org 1.x Draw) package as a flat OdgDocument.
export function readSxdContent(pkg: Package): OdgDocument {
  return readOdgContent(transformOoo1Package(pkg));
}

// A .sxd or .std package as a drawing DocumentTree.
export function readSxd(pkg: Package): DocumentTree {
  return readOdg(transformOoo1Package(pkg));
}
