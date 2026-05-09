import { useEffect } from "react";
import { Streamdown } from "streamdown";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { useChatStore } from "../../store/chat";
import type { BookSummary } from "../../store/chat";
import { fetchJson } from "../../hooks/use-api";
import { SidebarCard } from "./SidebarCard";
import type { SidebarLanguage } from "../chat/BookSidebar";

const streamdownPlugins = { cjk, code, math, mermaid };

const SIDEBAR_MD_CLASS =
  "text-xs text-muted-foreground leading-relaxed " +
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 " +
  "[&>p+p]:mt-1.5 [&_strong]:text-foreground [&_strong]:font-medium " +
  "[&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-0.5 " +
  "[&_h1]:hidden [&_h2]:text-xs [&_h2]:font-medium [&_h2]:text-foreground [&_h2]:mt-1.5 [&_h2]:mb-0.5 " +
  "[&_h3]:text-xs [&_h3]:font-medium [&_h3]:text-foreground [&_h3]:mt-1.5 [&_h3]:mb-0.5 " +
  "[&_code]:text-[11px] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:bg-secondary/60";

function parseStoryBible(content: string): BookSummary {
  const sections = content.split(/^##\s+/m);
  let world = "";
  let protagonist = "";
  let cast = "";

  for (const section of sections) {
    if (/^0?1[_\s]|世界观|세계관|world/i.test(section)) {
      world = section.replace(/^[^\n]+\n/, "").trim().split("\n\n")[0] ?? "";
    } else if (/^0?2[_\s]|主角|주인공|protagonist/i.test(section)) {
      protagonist = section.replace(/^[^\n]+\n/, "").trim().split("\n\n")[0] ?? "";
    } else if (/^0?3[_\s]|配角|조연|등장인물|supporting|cast/i.test(section)) {
      cast = section.replace(/^[^\n]+\n/, "").trim().split("\n\n")[0] ?? "";
    }
  }

  return { world, protagonist, cast };
}

interface SummarySectionProps {
  readonly bookId: string;
  readonly language: SidebarLanguage;
}

export function SummarySection({ bookId, language }: SummarySectionProps) {
  const summary = useChatStore((s) => s.bookSummary);
  const setBookSummary = useChatStore((s) => s.setBookSummary);
  const bookDataVersion = useChatStore((s) => s.bookDataVersion);

  useEffect(() => {
    setBookSummary(null);
    fetchJson<{ content: string | null }>(`/books/${bookId}/truth/story_bible.md`)
      .then((data) => {
        if (data.content) setBookSummary(parseStoryBible(data.content));
      })
      .catch(() => {});
  }, [bookId, bookDataVersion, setBookSummary]);

  if (!summary) return null;

  return (
    <>
      {summary.world && (
        <SidebarCard title={language === "ko" ? "세계관" : language === "en" ? "World" : "世界观"}>
          <Streamdown className={SIDEBAR_MD_CLASS} plugins={streamdownPlugins}>
            {summary.world}
          </Streamdown>
        </SidebarCard>
      )}
      {(summary.protagonist || summary.cast) && (
        <SidebarCard title={language === "ko" ? "인물" : language === "en" ? "Characters" : "角色"}>
          {summary.protagonist && (
            <Streamdown className={SIDEBAR_MD_CLASS} plugins={streamdownPlugins}>
              {summary.protagonist}
            </Streamdown>
          )}
          {summary.cast && (
            <div className={summary.protagonist ? "mt-2" : undefined}>
              <Streamdown className={SIDEBAR_MD_CLASS} plugins={streamdownPlugins}>
                {summary.cast}
              </Streamdown>
            </div>
          )}
        </SidebarCard>
      )}
    </>
  );
}
