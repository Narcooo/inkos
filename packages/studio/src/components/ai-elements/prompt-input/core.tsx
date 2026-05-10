"use client";

import {
  InputGroup,
  InputGroupAddon,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import type { SourceDocumentUIPart } from "ai";
import { nanoid } from "nanoid";
import type {
  ComponentProps,
  FormEvent,
  HTMLAttributes,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useAttachmentFilesRef,
  useDropAttachments,
  useFileInputChange,
  useLocalPromptInputAttachments,
  useProviderPromptInputAttachmentAdd,
  useRevokeLocalAttachmentsOnUnmount,
} from "./attachment-hooks";
import {
  type AttachmentsContext,
  LocalAttachmentsContext,
  LocalReferencedSourcesContext,
  type ReferencedSourcesContext,
  useOptionalPromptInputController,
} from "./context";
import { type PromptInputMessage, usePromptInputSubmit } from "./submission";
export type { PromptInputMessage } from "./submission";
export { type PromptInputTextareaProps, PromptInputTextarea } from "./textarea";

export type PromptInputProps = Omit<
  HTMLAttributes<HTMLFormElement>,
  "onSubmit" | "onError"
> & {
  accept?: string;
  multiple?: boolean;
  globalDrop?: boolean;
  syncHiddenInput?: boolean;
  maxFiles?: number;
  maxFileSize?: number;
  onError?: (err: {
    code: "max_files" | "max_file_size" | "accept";
    message: string;
  }) => void;
  onSubmit: (
    message: PromptInputMessage,
    event: FormEvent<HTMLFormElement>
  ) => void | Promise<void>;
};

export const PromptInput = ({
  className,
  accept,
  multiple,
  globalDrop,
  syncHiddenInput,
  maxFiles,
  maxFileSize,
  onError,
  onSubmit,
  children,
  ...props
}: PromptInputProps) => {
  const controller = useOptionalPromptInputController();
  const usingProvider = !!controller;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const attachmentOptions = useMemo(
    () => ({ accept, maxFiles, maxFileSize, onError }),
    [accept, maxFiles, maxFileSize, onError]
  );
  const localAttachments = useLocalPromptInputAttachments(attachmentOptions);
  const files = usingProvider ? controller.attachments.files : localAttachments.files;
  const [referencedSources, setReferencedSources] = useState<
    (SourceDocumentUIPart & { id: string })[]
  >([]);
  const filesRef = useAttachmentFilesRef(files);

  const openFileDialogLocal = useCallback(() => {
    inputRef.current?.click();
  }, []);
  const addWithProviderValidation = useProviderPromptInputAttachmentAdd({
    controller,
    files,
    options: attachmentOptions,
  });
  const clearAttachments = usingProvider
    ? controller.attachments.clear
    : localAttachments.clear;

  const clearReferencedSources = useCallback(
    () => setReferencedSources([]),
    []
  );

  const add = usingProvider ? addWithProviderValidation : localAttachments.add;
  const remove = usingProvider
    ? controller.attachments.remove
    : localAttachments.remove;
  const openFileDialog = usingProvider
    ? controller.attachments.openFileDialog
    : openFileDialogLocal;

  const clear = useCallback(() => {
    clearAttachments();
    clearReferencedSources();
  }, [clearAttachments, clearReferencedSources]);

  useEffect(() => {
    if (!usingProvider) {
      return;
    }
    controller.__registerFileInput(inputRef, () => inputRef.current?.click());
  }, [usingProvider, controller]);

  useEffect(() => {
    if (syncHiddenInput && inputRef.current && files.length === 0) {
      inputRef.current.value = "";
    }
  }, [files, syncHiddenInput]);

  useDropAttachments({ add, formRef, globalDrop });
  useRevokeLocalAttachmentsOnUnmount({
    enabled: !usingProvider,
    filesRef,
  });

  const handleChange = useFileInputChange(add);

  const attachmentsCtx = useMemo<AttachmentsContext>(
    () => ({
      add,
      clear: clearAttachments,
      fileInputRef: inputRef,
      files: files.map((item) => ({ ...item, id: item.id })),
      openFileDialog,
      remove,
    }),
    [files, add, remove, clearAttachments, openFileDialog]
  );

  const refsCtx = useMemo<ReferencedSourcesContext>(
    () => ({
      add: (incoming: SourceDocumentUIPart[] | SourceDocumentUIPart) => {
        const array = Array.isArray(incoming) ? incoming : [incoming];
        setReferencedSources((prev) => [
          ...prev,
          ...array.map((s) => ({ ...s, id: nanoid() })),
        ]);
      },
      clear: clearReferencedSources,
      remove: (id: string) => {
        setReferencedSources((prev) => prev.filter((s) => s.id !== id));
      },
      sources: referencedSources,
    }),
    [referencedSources, clearReferencedSources]
  );

  const handleSubmit = usePromptInputSubmit({
    clear,
    controller,
    files,
    onSubmit,
    usingProvider,
  });

  const inner = (
    <>
      <input
        accept={accept}
        aria-label="Upload files"
        className="hidden"
        multiple={multiple}
        onChange={handleChange}
        ref={inputRef}
        title="Upload files"
        type="file"
      />
      <form
        className={cn("w-full", className)}
        onSubmit={handleSubmit}
        ref={formRef}
        {...props}
      >
        <InputGroup className="overflow-hidden">{children}</InputGroup>
      </form>
    </>
  );

  return (
    <LocalAttachmentsContext.Provider value={attachmentsCtx}>
      <LocalReferencedSourcesContext.Provider value={refsCtx}>
        {inner}
      </LocalReferencedSourcesContext.Provider>
    </LocalAttachmentsContext.Provider>
  );
};

export type PromptInputBodyProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputBody = ({
  className,
  ...props
}: PromptInputBodyProps) => (
  <div className={cn("contents", className)} {...props} />
);

export type PromptInputHeaderProps = Omit<
  ComponentProps<typeof InputGroupAddon>,
  "align"
>;

export const PromptInputHeader = ({
  className,
  ...props
}: PromptInputHeaderProps) => (
  <InputGroupAddon
    align="block-end"
    className={cn("order-first flex-wrap gap-1", className)}
    {...props}
  />
);

export type PromptInputFooterProps = Omit<
  ComponentProps<typeof InputGroupAddon>,
  "align"
>;

export const PromptInputFooter = ({
  className,
  ...props
}: PromptInputFooterProps) => (
  <InputGroupAddon
    align="block-end"
    className={cn("justify-between gap-1", className)}
    {...props}
  />
);

export type PromptInputToolsProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputTools = ({
  className,
  ...props
}: PromptInputToolsProps) => (
  <div
    className={cn("flex min-w-0 items-center gap-1", className)}
    {...props}
  />
);
