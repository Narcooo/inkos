"use client";

import type { FileUIPart } from "ai";
import { nanoid } from "nanoid";
import type { ChangeEventHandler, RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PromptInputControllerProps } from "./context";

export type PromptInputAttachment = FileUIPart & { id: string };

export type PromptInputAttachmentError = {
  code: "max_files" | "max_file_size" | "accept";
  message: string;
};

type AttachmentOptions = {
  accept?: string;
  maxFiles?: number;
  maxFileSize?: number;
  onError?: (err: PromptInputAttachmentError) => void;
};

const fileMatchesAccept = (file: File, accept?: string) => {
  if (!accept || accept.trim() === "") {
    return true;
  }

  const patterns = accept
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return patterns.some((pattern) => {
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -1);
      return file.type.startsWith(prefix);
    }
    return file.type === pattern;
  });
};

const collectAcceptedFiles = (
  fileList: File[] | FileList,
  options: AttachmentOptions
) => {
  const incoming = [...fileList];
  const accepted = incoming.filter((file) =>
    fileMatchesAccept(file, options.accept)
  );
  if (incoming.length && accepted.length === 0) {
    options.onError?.({
      code: "accept",
      message: "No files match the accepted types.",
    });
    return [];
  }

  const sized = accepted.filter((file) =>
    options.maxFileSize ? file.size <= options.maxFileSize : true
  );
  if (accepted.length > 0 && sized.length === 0) {
    options.onError?.({
      code: "max_file_size",
      message: "All files exceed the maximum size.",
    });
    return [];
  }

  return sized;
};

const toAttachment = (file: File): PromptInputAttachment => ({
  filename: file.name,
  id: nanoid(),
  mediaType: file.type,
  type: "file",
  url: URL.createObjectURL(file),
});

const revokeAttachmentUrl = (file: FileUIPart) => {
  if (file.url) {
    URL.revokeObjectURL(file.url);
  }
};

export const useLocalPromptInputAttachments = (
  options: AttachmentOptions
) => {
  const [items, setItems] = useState<PromptInputAttachment[]>([]);

  const add = useCallback(
    (fileList: File[] | FileList) => {
      const sized = collectAcceptedFiles(fileList, options);
      if (sized.length === 0) {
        return;
      }

      setItems((prev) => {
        const capacity =
          typeof options.maxFiles === "number"
            ? Math.max(0, options.maxFiles - prev.length)
            : undefined;
        const capped =
          typeof capacity === "number" ? sized.slice(0, capacity) : sized;
        if (typeof capacity === "number" && sized.length > capacity) {
          options.onError?.({
            code: "max_files",
            message: "Too many files. Some were not added.",
          });
        }
        return [...prev, ...capped.map(toAttachment)];
      });
    },
    [options]
  );

  const remove = useCallback(
    (id: string) =>
      setItems((prev) => {
        const found = prev.find((file) => file.id === id);
        if (found) {
          revokeAttachmentUrl(found);
        }
        return prev.filter((file) => file.id !== id);
      }),
    []
  );

  const clear = useCallback(
    () =>
      setItems((prev) => {
        for (const file of prev) {
          revokeAttachmentUrl(file);
        }
        return [];
      }),
    []
  );

  return { add, clear, files: items, remove };
};

export const useProviderPromptInputAttachmentAdd = ({
  controller,
  files,
  options,
}: {
  controller: PromptInputControllerProps | null;
  files: PromptInputAttachment[];
  options: AttachmentOptions;
}) =>
  useCallback(
    (fileList: File[] | FileList) => {
      const sized = collectAcceptedFiles(fileList, options);
      if (sized.length === 0) {
        return;
      }

      const capacity =
        typeof options.maxFiles === "number"
          ? Math.max(0, options.maxFiles - files.length)
          : undefined;
      const capped =
        typeof capacity === "number" ? sized.slice(0, capacity) : sized;
      if (typeof capacity === "number" && sized.length > capacity) {
        options.onError?.({
          code: "max_files",
          message: "Too many files. Some were not added.",
        });
      }

      if (capped.length > 0) {
        controller?.attachments.add(capped);
      }
    },
    [controller, files.length, options]
  );

export const useDropAttachments = ({
  add,
  formRef,
  globalDrop,
}: {
  add: (files: File[] | FileList) => void;
  formRef: RefObject<HTMLFormElement | null>;
  globalDrop?: boolean;
}) => {
  useEffect(() => {
    const target: Document | HTMLFormElement | null = globalDrop
      ? document
      : formRef.current;
    if (!target) {
      return;
    }

    const onDragOver = (event: Event) => {
      const dragEvent = event as DragEvent;
      if (dragEvent.dataTransfer?.types?.includes("Files")) {
        dragEvent.preventDefault();
      }
    };
    const onDrop = (event: Event) => {
      const dragEvent = event as DragEvent;
      if (dragEvent.dataTransfer?.types?.includes("Files")) {
        dragEvent.preventDefault();
      }
      if (
        dragEvent.dataTransfer?.files &&
        dragEvent.dataTransfer.files.length > 0
      ) {
        add(dragEvent.dataTransfer.files);
      }
    };

    target.addEventListener("dragover", onDragOver);
    target.addEventListener("drop", onDrop);
    return () => {
      target.removeEventListener("dragover", onDragOver);
      target.removeEventListener("drop", onDrop);
    };
  }, [add, formRef, globalDrop]);
};

export const useFileInputChange = (
  add: (files: File[] | FileList) => void
): ChangeEventHandler<HTMLInputElement> =>
  useCallback(
    (event) => {
      if (event.currentTarget.files) {
        add(event.currentTarget.files);
      }
      event.currentTarget.value = "";
    },
    [add]
  );

export const useAttachmentFilesRef = (files: PromptInputAttachment[]) => {
  const filesRef = useRef(files);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  return filesRef;
};

export const useRevokeLocalAttachmentsOnUnmount = ({
  enabled,
  filesRef,
}: {
  enabled: boolean;
  filesRef: RefObject<PromptInputAttachment[]>;
}) => {
  useEffect(
    () => () => {
      if (!enabled) {
        return;
      }
      for (const file of filesRef.current) {
        revokeAttachmentUrl(file);
      }
    },
    [enabled, filesRef]
  );
};
