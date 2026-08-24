import { useEffect, useState } from 'react';

// Creates a fresh blob: URL whenever `bytes` changes and revokes the previous one, so PdfPreview's <iframe> always points at a live object URL without leaking one per render. Browsers render a PDF blob URL natively inside an iframe -- no PDF.js or other viewer library needed.
export function usePdfObjectUrl(bytes: Uint8Array<ArrayBuffer> | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (bytes === undefined) {
      setUrl(undefined);
      return;
    }
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    setUrl(objectUrl);
    return () => { URL.revokeObjectURL(objectUrl); };
  }, [bytes]);

  return url;
}
