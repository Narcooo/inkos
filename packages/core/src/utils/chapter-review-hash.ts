import {createHash} from 'node:crypto';
import {chapterDocumentBody} from './chapter-document.js';

/** Bind draft reviews to persisted prose independently of its document heading. */
export function chapterReviewContentHash(content:string,chapterNumber:number):string{
  return 'sha256:'+createHash('sha256').update(chapterDocumentBody(content,chapterNumber,'','zh').trim()).digest('hex');
}
