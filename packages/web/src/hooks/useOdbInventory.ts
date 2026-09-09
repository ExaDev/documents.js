import { useMutation } from "@tanstack/react-query";

import { getRpcClient } from "../rpc/client";

export function useReadOdb() {
  return useMutation({
    mutationFn: (
      input: Parameters<ReturnType<typeof getRpcClient>["odb"]["read"]>[0],
    ) => getRpcClient().odb.read(input),
  });
}
