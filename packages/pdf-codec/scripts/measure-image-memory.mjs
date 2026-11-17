// Measures the memory reading a picture-heavy PDF's images costs, against the built dist/ (run `pnpm build` first):
//
//   node scripts/measure-image-memory.mjs per-image [--gc]   # openPdfImages: list, then decode every image one at a time
//   node scripts/measure-image-memory.mjs read-pdf  [--gc]   # readPdf: every image decoded in one call, kept in its registry
//
// read-pdf mode takes --read-entry=<path to another build's dist/read.js> to measure an earlier release the same way, e.g. one installed with `npm install pdf-codec@5.8.6` in a scratch directory.
//
// The PDF is src/test-support/image-heavy-pdf.ts's pictureDeckPdf: shaped like a typical picture-heavy slide deck (about 2.5 MB, 108 images, Flate RGB with soft masks up to 2360x1309), generated, never a real document. The read runs in a worker thread, and this thread samples the worker's V8 heap statistics continuously while it runs: worker.getHeapStatistics() is answered through a V8 interrupt, so it samples inside a synchronous decode too, not only between calls. The figure reported is the peak of used_heap_size + external_memory, the second of which holds every ArrayBuffer's backing store: a typed array's bytes sit outside the V8 heap (and outside --max-old-space-size) but count towards a Cloudflare Worker isolate's 128 MB all the same. Garbage counts until the collector runs; --gc collects before each image, which shows what the decode itself needs at once rather than what the collector has yet to reclaim.
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const mode = process.argv[2] ?? "per-image";
const collect = process.argv.includes("--gc");
const readEntryArgument = process.argv.find((argument) =>
  argument.startsWith("--read-entry="),
);
const readEntry =
  readEntryArgument === undefined
    ? new URL("../dist/read.js", import.meta.url).href
    : new URL(readEntryArgument.slice("--read-entry=".length), `file://${process.cwd()}/`).href;
if (mode !== "per-image" && mode !== "read-pdf") {
  throw new Error(`unknown mode ${mode}: per-image or read-pdf`);
}

const jiti = createJiti(import.meta.url);
const { pictureDeckPdf } = await jiti.import(
  "../src/test-support/image-heavy-pdf.ts",
);
const pdf = pictureDeckPdf();

const worker = new Worker(
  fileURLToPath(new URL("./measure-image-memory-worker.mjs", import.meta.url)),
  {
    workerData: { mode, collect, pdf, readEntry },
  },
);
await new Promise((resolve) => worker.once("online", resolve));

const MB = 2 ** 20;
let peak = 0;
let baseline;
let report;
let failure;
worker.on("message", (message) => {
  if (message.kind === "ready") {
    baseline = message.memory;
  } else {
    report = message;
  }
});
worker.on("error", (error) => {
  failure = error;
});
const exited = new Promise((resolve) => worker.once("exit", resolve));
let running = true;
void exited.then(() => {
  running = false;
});
while (running) {
  try {
    const stats = await worker.getHeapStatistics();
    peak = Math.max(peak, stats.used_heap_size + stats.external_memory);
  } catch {
    break; // the worker exited between the check and the request
  }
}
await exited;
if (failure !== undefined) {
  throw failure;
}

const format = (bytes) => `${(bytes / MB).toFixed(1)} MB`;
console.log(`PDF: ${format(pdf.length)} (${String(pdf.length)} bytes)`);
console.log(
  `mode: ${mode}${collect ? " (collecting before each image)" : ""}${mode === "read-pdf" ? ` from ${readEntry}` : ""}`,
);
console.log(
  `before reading (module loaded, PDF bytes held): heapUsed + arrayBuffers = ${format(baseline.heapUsed + baseline.arrayBuffers)}`,
);
console.log(
  `peak heapUsed + arrayBuffers (sampled V8 used_heap_size + external_memory): ${format(peak)}`,
);
console.log(
  `images: ${String(report.images)} decoded (${String(report.pngs)} PNG, ${String(report.jpegs)} JPEG), largest ${report.largest}`,
);
console.log(
  `time: ${String(Math.round(report.wallMs))} ms wall, ${String(Math.round(report.cpuMs))} ms CPU`,
);
