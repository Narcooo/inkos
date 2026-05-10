"use client";

import type { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DropdownMenuItem as DropdownMenuItemPrimitive } from "@/components/ui/dropdown-menu";
import { ImageIcon, Monitor } from "lucide-react";
import { useCallback } from "react";
import { usePromptInputAttachments } from "./context";
import { captureScreenshot } from "./helpers";

export type PromptInputActionAddAttachmentsProps = React.ComponentProps<
  typeof DropdownMenuItem
> & {
  label?: string;
};

export const PromptInputActionAddAttachments = ({
  label = "Add photos or files",
  ...props
}: PromptInputActionAddAttachmentsProps) => {
  const attachments = usePromptInputAttachments();

  const handleSelect = useCallback(
    (e: { preventDefault: () => void }) => {
      e.preventDefault();
      attachments.openFileDialog();
    },
    [attachments]
  );

  return (
    <DropdownMenuItemPrimitive {...props} onSelect={handleSelect as any}>
      <ImageIcon className="mr-2 size-4" /> {label}
    </DropdownMenuItemPrimitive>
  );
};

export type PromptInputActionAddScreenshotProps = React.ComponentProps<
  typeof DropdownMenuItem
> & {
  label?: string;
};

export const PromptInputActionAddScreenshot = ({
  label = "Take screenshot",
  onSelect,
  ...props
}: PromptInputActionAddScreenshotProps) => {
  const attachments = usePromptInputAttachments();

  const handleSelect = useCallback(
    async (event: { preventDefault: () => void; defaultPrevented: boolean }) => {
      onSelect?.(event as any);
      if (event.defaultPrevented) {
        return;
      }

      try {
        const screenshot = await captureScreenshot();
        if (screenshot) {
          attachments.add([screenshot]);
        }
      } catch (error) {
        if (
          error instanceof DOMException &&
          (error.name === "NotAllowedError" || error.name === "AbortError")
        ) {
          return;
        }
        throw error;
      }
    },
    [onSelect, attachments]
  );

  return (
    <DropdownMenuItemPrimitive {...props} onSelect={handleSelect as any}>
      <Monitor className="mr-2 size-4" />
      {label}
    </DropdownMenuItemPrimitive>
  );
};
