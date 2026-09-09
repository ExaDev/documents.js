import { useMutation } from "@tanstack/react-query";

import { getRpcClient } from "../rpc/client";

export function useReadContent() {
  return useMutation({
    mutationFn: (
      input: Parameters<ReturnType<typeof getRpcClient>["content"]["read"]>[0],
    ) => getRpcClient().content.read(input),
  });
}

export function useRestoreContent() {
  return useMutation({
    mutationFn: (
      input: Parameters<
        ReturnType<typeof getRpcClient>["content"]["restore"]
      >[0],
    ) => getRpcClient().content.restore(input),
  });
}
