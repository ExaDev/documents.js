// The OCF (Open Container Format) media type every EPUB's own "mimetype" entry must contain, byte for byte -- EPUB 3.3 section 6.3 ("OCF ZIP Container"). Read and write both check against this exact string rather than a looser prefix match: the spec requires the entry's content to be precisely these bytes, no trailing newline, no BOM.
export const EPUB_MIME_TYPE = "application/epub+zip";

// The fixed OCF-mandated path of the container document that names the OPF rootfile -- EPUB 3.3 section 6.7.2.
export const OCF_CONTAINER_PATH = "META-INF/container.xml";

// The fixed OCF-mandated path of the mimetype entry itself, which must be the very first entry in the zip, stored uncompressed -- EPUB 3.3 section 6.3.
export const OCF_MIMETYPE_PATH = "mimetype";
