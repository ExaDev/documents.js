import { useMutation } from "@tanstack/react-query";

import { getRpcClient } from "../rpc/client";

// The Editors tool's five mutations, one per rpc procedure. All four snapshot-returning mutations answer the whole fresh paragraph list (the worker re-reads its live accessors per call), so the page state is nothing but the latest snapshot -- there is no client-side per-paragraph state to keep coherent.
export function useOpenEditor() {
  return useMutation({
    mutationFn: (
      input: Parameters<ReturnType<typeof getRpcClient>["editor"]["open"]>[0],
    ) => getRpcClient().editor.open(input),
  });
}

export function useSetParagraphText() {
  return useMutation({
    mutationFn: (
      input: Parameters<
        ReturnType<typeof getRpcClient>["editor"]["setParagraphText"]
      >[0],
    ) => getRpcClient().editor.setParagraphText(input),
  });
}

export function useAddParagraph() {
  return useMutation({
    mutationFn: (
      input: Parameters<
        ReturnType<typeof getRpcClient>["editor"]["addParagraph"]
      >[0],
    ) => getRpcClient().editor.addParagraph(input),
  });
}

export function useRemoveParagraph() {
  return useMutation({
    mutationFn: (
      input: Parameters<
        ReturnType<typeof getRpcClient>["editor"]["removeParagraph"]
      >[0],
    ) => getRpcClient().editor.removeParagraph(input),
  });
}

export function useSaveEditor() {
  return useMutation({
    mutationFn: (
      input: Parameters<ReturnType<typeof getRpcClient>["editor"]["save"]>[0],
    ) => getRpcClient().editor.save(input),
  });
}
