// Builds META-INF/container.xml (EPUB 3.3 section 6.7.2), naming the OPF rootfile this package always writes at a fixed path -- see src/write.ts for why that path is fixed rather than caller-configurable.
export function writeContainerXml(opfPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;
}
