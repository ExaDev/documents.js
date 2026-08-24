import { useMutation } from "@tanstack/react-query";

import { convertViaWorker } from "../adapters/documentConverter/workerDocumentConverter";

export function useConvert() {
  return useMutation({
    mutationFn: convertViaWorker,
  });
}
