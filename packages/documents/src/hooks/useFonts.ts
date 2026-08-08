import { useMutation } from '@tanstack/react-query';

import { getRpcClient } from '../rpc/client';

export function useExtractSourceFonts() {
  return useMutation({
    mutationFn: (input: Parameters<ReturnType<typeof getRpcClient>['fonts']['extractSourceFonts']>[0]) =>
      getRpcClient().fonts.extractSourceFonts(input),
  });
}

export function useDescribeFontFace() {
  return useMutation({
    mutationFn: (input: Parameters<ReturnType<typeof getRpcClient>['fonts']['describe']>[0]) =>
      getRpcClient().fonts.describe(input),
  });
}
