"use client";

import type {
  ClipboardEventHandler,
  KeyboardEventHandler,
  RefObject,
} from "react";
import { useCallback, useState } from "react";
import type { AttachmentsContext } from "./context";

export const usePromptInputTextareaKeyboard = ({
  attachments,
  onKeyDown,
}: {
  attachments: AttachmentsContext;
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
}) => {
  const [isComposing, setIsComposing] = useState(false);

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = useCallback(
    (event) => {
      onKeyDown?.(event);

      if (event.defaultPrevented) {
        return;
      }

      if (event.key === "Enter") {
        if (isComposing || event.nativeEvent.isComposing) {
          return;
        }
        if (event.shiftKey) {
          return;
        }
        event.preventDefault();

        const { form } = event.currentTarget;
        const submitButton = form?.querySelector(
          'button[type="submit"]'
        ) as HTMLButtonElement | null;
        if (submitButton?.disabled) {
          return;
        }

        form?.requestSubmit();
      }

      if (
        event.key === "Backspace" &&
        event.currentTarget.value === "" &&
        attachments.files.length > 0
      ) {
        event.preventDefault();
        const lastAttachment = attachments.files.at(-1);
        if (lastAttachment) {
          attachments.remove(lastAttachment.id);
        }
      }
    },
    [onKeyDown, isComposing, attachments]
  );

  return {
    handleCompositionEnd: useCallback(() => setIsComposing(false), []),
    handleCompositionStart: useCallback(() => setIsComposing(true), []),
    handleKeyDown,
  };
};

export const usePromptInputTextareaPaste = (
  attachments: AttachmentsContext
): ClipboardEventHandler<HTMLTextAreaElement> =>
  useCallback(
    (event) => {
      const items = event.clipboardData?.items;

      if (!items) {
        return;
      }

      const files: File[] = [];

      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) {
            files.push(file);
          }
        }
      }

      if (files.length > 0) {
        event.preventDefault();
        attachments.add(files);
      }
    },
    [attachments]
  );
