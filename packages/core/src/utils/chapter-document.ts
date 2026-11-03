import type { WritingLanguage } from "../models/book.js";
import {splitSourceLines} from './source-text.js';
import {readChapterHeading} from './chapter-splitter.js';

export function chapterDocumentHeading(number:number,title:string,language:WritingLanguage):string{
  if (language === "ru") return `# Глава ${number}: ${title}`;
  return language==='en'?`# Chapter ${number}: ${title}`:`# 第${number}章 ${title}`;
}

/** The numbered title belongs to the document wrapper, not the chapter prose. */
export function chapterDocumentBody(content:string,number:number,title:string,language:WritingLanguage):string{
  const heading=chapterDocumentHeading(number,title,language);
  const lines=splitSourceLines(content);
  let cursor=0,bodyStart=0;
  while(cursor<lines.length){
    while(cursor<lines.length&&!lines[cursor]!.trim())cursor++;
    const line=lines[cursor]?.trim();
    if(line!==heading&&(!line||readChapterHeading(line)?.number!==number))break;
    cursor++;
    while(cursor<lines.length&&!lines[cursor]!.trim())cursor++;
    bodyStart=cursor;
  }
  return bodyStart?lines.slice(bodyStart).join(''):content;
}

export function renderChapterDocument(number:number,title:string,content:string,language:WritingLanguage):string{
  return chapterDocumentHeading(number,title,language)+'\n\n'+chapterDocumentBody(content,number,title,language);
}
