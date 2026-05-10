"use client";

import type { FileUIPart } from "ai";
import type { FormEventHandler } from "react";
import { useCallback } from "react";
import type { PromptInputControllerProps } from "./context";
import { convertBlobUrlToDataUrl } from "./helpers";
import type { PromptInputAttachment } from "./attachment-hooks";

export interface PromptInputMessage {
  text: string;
  files: FileUIPart[];
}

type UsePromptInputSubmitOptions = {
  clear: () => void;
  controller: PromptInputControllerProps | null;
  files: PromptInputAttachment[];
  onSubmit: (
    message: PromptInputMessage,
    event: Parameters<FormEventHandler<HTMLFormElement>>[0]
  ) => void | Promise<void>;
  usingProvider: boolean;
};

export const usePromptInputSubmit = ({
  clear,
  controller,
  files,
  onSubmit,
  usingProvider,
}: UsePromptInputSubmitOptions): FormEventHandler<HTMLFormElement> =>
  useCallback(
    async (event) => {
      event.preventDefault();

      const form = event.currentTarget;
      const text = usingProvider
        ? controller?.textInput.value ?? ""
        : (() => {
            const formData = new FormData(form);
            return (formData.get("message") as string) || "";
          })();

      if (!usingProvider) {
        form.reset();
      }

      try {
        const convertedFiles: FileUIPart[] = await Promise.all(
          files.map(async ({ id: _id, ...item }) => {
            if (item.url?.startsWith("blob:")) {
              const dataUrl = await convertBlobUrlToDataUrl(item.url);
              return {
                ...item,
                url: dataUrl ?? item.url,
              };
            }
            return item;
          })
        );

        const result = onSubmit({ files: convertedFiles, text }, event);

        if (result instanceof Promise) {
          try {
            await result;
            clear();
            if (usingProvider) {
              controller?.textInput.clear();
            }
          } catch {
            // Keep user input intact so the submit can be retried.
          }
        } else {
          clear();
          if (usingProvider) {
            controller?.textInput.clear();
          }
        }
      } catch {
        // Keep user input intact so the submit can be retried.
      }
    },
    [usingProvider, controller, files, onSubmit, clear]
  );
