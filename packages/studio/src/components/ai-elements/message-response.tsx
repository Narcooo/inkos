"use client";

import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";
import { memo } from "react";
import { Streamdown } from "streamdown";
import { useStreamdownPlugins } from "./use-streamdown-plugins";

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

export const MessageResponse = memo(
  ({ className, children, ...props }: MessageResponseProps) => {
    const plugins = useStreamdownPlugins(children);

    return (
      <Streamdown
        className={cn(
          "size-full text-[16px] leading-[1.6] font-['SimSun','Songti_SC','STSong',serif] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&>p+p]:mt-4",
          className
        )}
        plugins={plugins}
        {...props}
      >
        {children}
      </Streamdown>
    );
  },
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    nextProps.isAnimating === prevProps.isAnimating
);

MessageResponse.displayName = "MessageResponse";
