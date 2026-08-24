// Plain mirror of documents.js's Diagnostic shape (defined as a Zod schema inside src/rpc/router.ts, which runs only in the worker) so UI code can type diagnostics without importing the worker-only router module.
export interface Diagnostic {
  severity: "info" | "warning";
  code: string;
  message: string;
  pageIndex?: number;
}
