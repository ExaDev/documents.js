import { describe, expect, it } from "vitest";
import { readPdf } from "./read";
import { metadataResiduePdf, minimalClassicXrefPdf } from "./test-support/pdf";

// A separately-typed copy of metadataResiduePdf's own XMP packet, not imported from the fixture: comparing the raw residue against the fixture's own source string would make the assertion trivially true under any change to that shared string, since both sides would mutate together. Independent duplication here is what lets the check actually verify byte-for-byte preservation rather than tautologically agreeing with itself.
const EXPECTED_METADATA_RESIDUE_XMP = [
  '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>',
  '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
  '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
  '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">',
  '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">From XMP</rdf:li></rdf:Alt></dc:title>',
  '<dc:description><rdf:Alt><rdf:li xml:lang="x-default">The XMP description</rdf:li></rdf:Alt></dc:description>',
  "<dc:subject><rdf:Bag><rdf:li>xmp</rdf:li><rdf:li>metadata</rdf:li></rdf:Bag></dc:subject>",
  "<dc:creator><rdf:Seq><rdf:li>XMP Author</rdf:li></rdf:Seq></dc:creator>",
  "<pdf:Producer>XMP Producer 9.9</pdf:Producer>",
  "</rdf:Description>",
  "</rdf:RDF>",
  "</x:xmpmeta>",
  '<?xpacket end="w"?>',
].join("\n");

// The metadata/residue cluster (#721 phase 6): catalog /Lang as the document language, the XMP /Metadata stream split into a semantic Dublin Core mirror (filling only fields /Info does not carry -- in a PDF/A file these live ONLY in XMP) and a raw-packet residue entry, and the package-level residue rows for the catalog and trailer facts no content node owns (viewer/session behaviour, output intents, private/application data, the trailer /ID).

describe("readPdf: document language and XMP", () => {
  it("reads catalog /Lang as metadata.language", () => {
    const doc = readPdf(metadataResiduePdf());
    expect(doc.metadata.language).toBe("en-GB");
  });

  it("prefers /Info for a field both /Info and XMP carry", () => {
    const doc = readPdf(metadataResiduePdf());
    expect(doc.metadata.title).toBe("From Info");
  });

  it("mirrors XMP Dublin Core fields /Info does not carry", () => {
    const doc = readPdf(metadataResiduePdf());
    expect(doc.metadata.subject).toBe("The XMP description");
    expect(doc.metadata.keywords).toEqual(["xmp", "metadata"]);
    expect(doc.metadata.producer).toBe("XMP Producer 9.9");
  });

  it("keeps the whole raw XMP packet as package-level residue", () => {
    const doc = readPdf(metadataResiduePdf());
    expect(doc.source?.xmp?.format).toBe("pdf");
    expect(doc.source?.xmp?.xml).toBe(EXPECTED_METADATA_RESIDUE_XMP);
  });
});

describe("readPdf: package-level residue rows", () => {
  it("carries viewer/session behaviour, output intents, and the trailer /ID as residue entries", () => {
    const doc = readPdf(metadataResiduePdf());
    expect(doc.source?.["viewer-preferences"]?.xml).toContain("/HideToolbar");
    expect(doc.source?.["page-mode"]?.xml).toBe("/UseOutlines");
    expect(doc.source?.["output-intents"]?.xml).toContain("/GTS_PDFA1");
    expect(doc.source?.["trailer-id"]?.xml).toContain("0a1b2c");
    expect(Object.keys(doc.source ?? {}).sort()).toEqual([
      "output-intents",
      "page-mode",
      "trailer-id",
      "viewer-preferences",
      "xmp",
    ]);
  });

  it("emits no residue entries for a document with none of these facts", () => {
    const doc = readPdf(minimalClassicXrefPdf());
    expect(doc.source).toBeUndefined();
  });
});
