"use client";

import { InputGroupTextarea } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import type { ChangeEvent, ComponentProps } from "react";
import {
  useOptionalPromptInputController,
  usePromptInputAttachments,
} from "./context";
import {
  usePromptInputTextareaKeyboard,
  usePromptInputTextareaPaste,
} from "./textarea-keyboard";

export type PromptInputTextareaProps = ComponentProps<
  typeof InputGroupTextarea
>;

export const PromptInputTextarea = ({
  onChange,
  onKeyDown,
  className,
  placeholder = "What would you like to know?",
  ...props
}: PromptInputTextareaProps) => {
  const controller = useOptionalPromptInputController();
  const attachments = usePromptInputAttachments();
  const { handleCompositionEnd, handleCompositionStart, handleKeyDown } =
    usePromptInputTextareaKeyboard({ attachments, onKeyDown });
  const handlePaste = usePromptInputTextareaPaste(attachments);

  const controlledProps = controller
    ? {
        onChange: (event: ChangeEvent<HTMLTextAreaElement>) => {
          controller.textInput.setInput(event.currentTarget.value);
          onChange?.(event);
        },
        value: controller.textInput.value,
      }
    : {
        onChange,
      };

  return (
    <InputGroupTextarea
      className={cn("field-sizing-content max-h-48 min-h-16", className)}
      name="message"
      onCompositionEnd={handleCompositionEnd}
      onCompositionStart={handleCompositionStart}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      placeholder={placeholder}
      {...props}
      {...controlledProps}
    />
  );
};
