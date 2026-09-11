// The public surface of this backend is deliberately one thing: a factory for the port's rasteriser. Everything a render needs -- the page walk, the coordinate transforms, the text-outline resolution -- lives behind pdf-codec's renderPdfPage; this package only answers draw ops with pixels, so its exports are the implementation class, the factory pdf-codec's own README reaches for, and the options/diagnostic types those carry.
export { CpuRasteriser, createCpuRasteriser } from "./rasteriser";
export type { CpuRasteriserOptions, RasterCpuDiagnostic } from "./rasteriser";
