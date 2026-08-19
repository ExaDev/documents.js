import { useMutation } from '@tanstack/react-query';

import { getRpcClient } from '../rpc/client';

export function useReadMetadata() {
  return useMutation({
    mutationFn: (input: Parameters<ReturnType<typeof getRpcClient>['metadata']['read']>[0]) =>
      getRpcClient().metadata.read(input),
  });
}

export function useWriteMetadata() {
  return useMutation({
    mutationFn: (input: Parameters<ReturnType<typeof getRpcClient>['metadata']['write']>[0]) =>
      getRpcClient().metadata.write(input),
  });
}
