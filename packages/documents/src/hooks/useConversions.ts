import { useQuery } from '@tanstack/react-query';

import { getRpcClient } from '../rpc/client';

// Static per documents.js version -- fetched once from the worker's own createLocalDocumentConverter().conversions rather than hand-copied into the UI, so a new pair the library adds shows up here with no frontend change.
export function useConversions() {
  return useQuery({
    queryKey: ['formats', 'listConversions'],
    queryFn: () => getRpcClient().formats.listConversions(),
    staleTime: Infinity,
  });
}

export function useDocumentFormats() {
  return useQuery({
    queryKey: ['formats', 'list'],
    queryFn: () => getRpcClient().formats.list(),
    staleTime: Infinity,
  });
}
