import type { PdfDiagnosticSink } from './diagnostics';
import type { PdfObjectResolver } from './interpret';
import { decodeStream } from './filters';
import type { LayoutAttachment } from './layout';
import { walkNameTree } from './names';
import type { PdfDict, PdfObject } from './objects';
import { asArray, asName, dictGet } from './objects';
import { decodePdfString } from './pdf-text';
import { bytesToBase64 } from './util/base64';

// Embedded-file reading (#721): one collector for the three places a PDF states an attachment -- the /Names /EmbeddedFiles name tree (the primary, addressable-by-name store), /FileAttachment annotations' /FS filespecs (a file pinned to a page rectangle), and catalog /AF associated files (ISO 32000-2's machine-readable association list). Collection order is that same order, and a filespec whose name was already collected collapses into the first entry: the name is the attachment's identity, and the same file reached through two routes is one attachment, not two.

export function readAttachments(catalog: PdfDict, pages: readonly PdfDict[], resolver: PdfObjectResolver, sink: PdfDiagnosticSink): LayoutAttachment[] {
  const attachments: LayoutAttachment[] = [];
  const seen = new Set<string>();

  const collect = (filespecRef: PdfObject | undefined): void => {
    const filespec = resolver.resolveDict(filespecRef);
    if (filespec === undefined) {
      return;
    }
    const name = filespecName(filespec);
    if (name === undefined || seen.has(name)) {
      return;
    }
    const attachment = readFilespec(name, filespec, resolver, sink);
    if (attachment !== undefined) {
      seen.add(name);
      attachments.push(attachment);
    }
  };

  // The /Names /EmbeddedFiles tree: entries are name -> filespec.
  const namesRoot = resolver.resolveDict(dictGet(catalog, 'Names'));
  for (const entry of walkNameTree(namesRoot === undefined ? undefined : dictGet(namesRoot, 'EmbeddedFiles'), resolver, sink)) {
    collect(entry.value);
  }

  // /FileAttachment annotations: each carries its whole filespec in /FS.
  for (const page of pages) {
    const annots = asArray(dictGet(page, 'Annots'));
    if (annots === undefined) {
      continue;
    }
    for (const annotRef of annots) {
      const annot = resolver.resolveDict(annotRef);
      if (annot !== undefined && asName(dictGet(annot, 'Subtype')) === 'FileAttachment') {
        collect(dictGet(annot, 'FS'));
      }
    }
  }

  // Catalog /AF: the ISO 32000-2 associated-files array, whose elements are filespecs.
  const af = asArray(resolver.resolve(dictGet(catalog, 'AF')));
  if (af !== undefined) {
    for (const filespecRef of af) {
      collect(filespecRef);
    }
  }

  return attachments;
}

// A filespec's own name: /UF (the Unicode form, preferred when present) falling back to /F -- a producer may write either or both, and /F is not guaranteed representable outside PDFDocEncoding.
function filespecName(filespec: PdfDict): string | undefined {
  for (const key of ['UF', 'F']) {
    const obj = dictGet(filespec, key);
    if (obj?.kind === 'string') {
      return decodePdfString(obj.bytes);
    }
  }
  return undefined;
}

// One filespec -> one attachment: /Desc, and the /EF /F (falling back to /EF /UF) embedded stream decoded through the ordinary filter path. A filespec with no resolvable embedded stream contributes nothing -- an external/referenced file spec has no bytes to carry, and the name alone is not an attachment.
function readFilespec(name: string, filespec: PdfDict, resolver: PdfObjectResolver, sink: PdfDiagnosticSink): LayoutAttachment | undefined {
  const ef = resolver.resolveDict(dictGet(filespec, 'EF'));
  if (ef === undefined) {
    return undefined;
  }
  for (const key of ['F', 'UF']) {
    const streamObj = resolver.resolve(dictGet(ef, key));
    if (streamObj?.kind !== 'stream') {
      continue;
    }
    const decoded = decodeStream(streamObj.raw, streamObj.dict, sink);
    const descObj = dictGet(filespec, 'Desc');
    const subtype = asName(dictGet(streamObj.dict, 'Subtype'));
    return {
      name,
      ...(descObj?.kind === 'string' ? { description: decodePdfString(descObj.bytes) } : {}),
      ...(subtype !== undefined ? { mimeType: subtype } : {}),
      base64: bytesToBase64(decoded.bytes),
    };
  }
  sink({ code: 'pdf/embedded-file-missing-stream', severity: 'warning', message: 'a filespec declares /EF but neither /F nor /UF resolves to an embedded stream' });
  return undefined;
}
