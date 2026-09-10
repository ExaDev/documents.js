import { useMutation } from "@tanstack/react-query";

import { getRpcClient } from "../rpc/client";

export function useOdmRender() {
  return useMutation({
    mutationFn: (
      input: Parameters<ReturnType<typeof getRpcClient>["odm"]["render"]>[0],
    ) => getRpcClient().odm.render(input),
  });
}
