import type { WritingLanguage } from "../models/book.js";

export interface SplitChapter {
  readonly title: string;
  readonly content: string;
}

const NUMBERED_HEADING = /^#{0,6}\s*(?:第([零〇○Ｏ０一二三四五六七八九十百千万\d]+)(章|回)(?:[:：]|\s+)?\s*(.*)|Chapter\s+(\d+|[IVXLCDM]+)[.:]?\s*(.*))$/i;

/** Numbered document syntax shared by persistence, export and import. */
export function readChapterHeading(line: string): {number:number;title:string;language:WritingLanguage} | undefined {
  const text = line.trim();
  const russian = /^#{0,6}\s*Глава\s+(\d+|[IVXLCDM]+)(?=$|[\s.:])(?:[.:]|[ \t]+[–—-])?\s*(.*)$/iu.exec(text);
  const match=NUMBERED_HEADING.exec(russian ? `Chapter ${russian[1]}: ${russian[2]}` : text);
  if(!match)return undefined;
  const ordinal=match[1]??match[4]!;
  let number=Number(ordinal);
  if(!Number.isFinite(number)){
    if(match[4]){
      const values:Record<string,number>={I:1,V:5,X:10,L:50,C:100,D:500,M:1000};
      const digits=[...ordinal.toUpperCase()].map(c=>values[c]!);
      number=digits.reduce((sum,value,index)=>sum+(value<(digits[index+1]??0)?-value:value),0);
    }else{
      const digits:Record<string,number>={'零':0,'〇':0,'○':0,'Ｏ':0,'０':0,'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
      const units:Record<string,number>={'十':10,'百':100,'千':1000,'万':10000};
      let total=0,section=0,value=0;
      for(const character of ordinal){
        const unit=units[character];
        if(!unit){value=value*10+(digits[character]??Number(character));continue;}
        if(unit===10000){total+=(section+value||1)*unit;section=0;}else section+=(value||1)*unit;
        value=0;
      }
      number=total+section+value;
    }
  }
  if(!Number.isSafeInteger(number)||number<0)return undefined;
  return{number,title:(match[3]??match[5]??'').trim(),language:russian?'ru':match[1]?'zh':'en'};
}

/**
 * Split a single text file into chapters by matching title lines.
 *
 * Default pattern matches:
 * - "第一章 xxxx" / "第1章 xxxx"
 * - "第一回 xxxx" / "第1回 xxxx"
 * - "# 第1章 xxxx" / "## 第23章 xxxx"
 * - "CHAPTER I." / "CHAPTER II."
 *
 * Each match marks the start of a new chapter. Content between matches
 * belongs to the preceding chapter.
 */
export function splitChapters(
  text: string,
  pattern?: string,
): ReadonlyArray<SplitChapter> {
  const regex = pattern ? new RegExp(pattern, "m") : undefined;

  const lines = text.split("\n");
  const chapters: Array<{ title: string; startLine: number; number?: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const heading = regex ? undefined : readChapterHeading(lines[i]!);
    const match = regex ? lines[i]!.match(regex) : undefined;
    if (heading || match) {
      const previous=chapters.at(-1);
      // Consecutive aliases of the same numbered heading wrap one chapter.
      // Never discard an empty chapter with a different number or intervening prose.
      if(heading&&previous?.number===heading.number&&!lines.slice(previous.startLine+1,i).join('\n').trim()){
        previous.title ||= heading.title;
        previous.startLine=i;
        continue;
      }
      chapters.push({
        title: heading?.title ?? (match?.[1] ?? match?.[2] ?? "").trim(),
        startLine: i,
        ...(heading?{number:heading.number}:{}),
      });
    }
  }

  if (chapters.length === 0) {
    return [];
  }

  const result: SplitChapter[] = [];

  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i]!;
    const nextStart = i + 1 < chapters.length ? chapters[i + 1]!.startLine : lines.length;

    // Content starts after the title line
    const contentLines = lines.slice(chapter.startLine + 1, nextStart);
    const content = contentLines.join("\n").trim();

    result.push({
      title: chapter.title || inferFallbackTitle(lines[chapter.startLine] ?? "", i + 1),
      content,
    });
  }

  return result;
}

function inferFallbackTitle(headingLine: string, chapterNumber: number): string {
  if (readChapterHeading(headingLine)?.language === "ru") return `Глава ${chapterNumber}`;

  if (/chapter\s+(?:\d+|[ivxlcdm]+)/i.test(headingLine)) {
    return `Chapter ${chapterNumber}`;
  }

  if (/第[零一二三四五六七八九十百千万\d]+回/.test(headingLine)) {
    return `第${chapterNumber}回`;
  }

  return `第${chapterNumber}章`;
}
