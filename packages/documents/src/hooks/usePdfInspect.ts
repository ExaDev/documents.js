import { useMutation } from '@tanstack/react-query';

import { getRpcClient } from '../rpc/client';

export function usePdfInspect() {
  return useMutation({
    mutationFn: (input: Parameters<ReturnType<typeof getRpcClient>['pdf']['inspect']>[0]) =>
      getRpcClient().pdf.inspect(input),
  });
}
