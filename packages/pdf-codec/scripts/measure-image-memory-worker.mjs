// The read measure-image-memory.mjs samples: runs in a worker thread so that thread can watch this one's heap. See that script for what is measured.
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { parentPort, workerData } from "node:worker_threads";

const { mode, collect, pdf, readEntry } = workerData;
// Each mode loads only the module it measures, as a memory-capped Worker bundling that one entry would, never the barrel: the barrel's write half carries ~2.9 MB of vendored fonts, and readPdf's text pipeline (font resolution and its glyph tables) about 12 MB of heap that the per-image reader never loads.
const { readPdf } =
  mode === "read-pdf" ? await import(readEntry) : { readPdf: undefined };
const { openPdfImages } =
  mode === "per-image"
    ? await import("../dist/read-images.js")
    : { openPdfImages: undefined };
// A worker cannot be started with --expose-gc, so it exposes the collector to itself.
if (collect) {
  setFlagsFromString("--expose-gc");
}
const gc = collect ? runInNewContext("gc") : () => undefined;

const counts = { images: 0, pngs: 0, jpegs: 0, largestPixels: 0, largest: "" };
const count = (image) => {
  counts.images += 1;
  counts[image.format === "png" ? "pngs" : "jpegs"] += 1;
  if (image.widthPx * image.heightPx > counts.largestPixels) {
    counts.largestPixels = image.widthPx * image.heightPx;
    counts.largest = `${String(image.widthPx)}x${String(image.heightPx)} ${image.format}`;
  }
};

gc();
const memory = process.memoryUsage();
parentPort.postMessage({ kind: "ready", memory });
const started = performance.now();
const cpuStarted = process.cpuUsage();

if (mode === "per-image") {
  const images = openPdfImages(pdf);
  const listing = images.list();
  for (const entry of listing) {
    gc();
    const decoded = images.decode(entry.locator);
    if (decoded !== undefined) {
      count(decoded);
    }
  }
} else {
  gc();
  const doc = readPdf(pdf);
  for (const asset of Object.values(doc.images)) {
    count(asset);
  }
}

const cpu = process.cpuUsage(cpuStarted);
parentPort.postMessage({
  kind: "done",
  ...counts,
  wallMs: performance.now() - started,
  cpuMs: (cpu.user + cpu.system) / 1000,
});
