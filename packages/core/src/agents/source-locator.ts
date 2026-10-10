import {Type} from '@sinclair/typebox';
import {BaseAgent} from './base.js';
import {authorTextScopeRequest,sourceUnits,type AuthorTextScope} from './author-edit-scope.js';
import {recordExecutionEvidence} from '../harness/execution-evidence.js';

const LocationSchema=Type.Object({
  kind:Type.Union([Type.Literal('document'),Type.Literal('paragraphs'),Type.Literal('reference')]),
  boundary:Type.Union([Type.Literal('first'),Type.Literal('last'),Type.Literal('none')]),
  count:Type.Integer({minimum:0}),
  target:Type.String({description:'For reference only: the requested location with all its qualifiers, without the desired creative effect. Otherwise empty.'}),
},{additionalProperties:false});

export interface SourceIdentity {
  readonly kind:'chapter'|'artifact';
  readonly chapterNumber?:number;
  readonly title?:string;
  readonly path?:string;
}

/** Interpret location before reading the prose that may tempt a wider edit.
 * Positional addresses are resolved by the host against the immutable source. */
export class SourceLocatorAgent extends BaseAgent {
  get name(){return 'source-locator';}

  async select(content:string,authorRequest:string,identity:SourceIdentity):Promise<AuthorTextScope>{
    const paragraphs=sourceUnits(content).paragraphs.filter(paragraph=>!paragraph.lines.every(({text})=>
      /^ {0,3}#{1,6}(?:\s|$)/u.test(text)||/^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/u.test(text.trimEnd())));
    const {result:location}=await this.submitStructured([
      {role:'system',content:'Identify only the location the author permits editing. Do not plan how to improve the writing. The supplied identity describes the complete document available for this operation; other documents mentioned in the request are not inside it. Use paragraphs for an explicit first/last paragraph or first/last N paragraphs: paragraphs are blank-line-separated text blocks, excluding Markdown headings and horizontal rules, not thematic scenes or narrative sequences. Use document only when the author permits editing the whole supplied document. Otherwise use reference and retain every location qualifier, including speaker, scene, position and whether only speech is editable, while omitting the requested artistic effect. For document/reference set boundary=none and count=0. For document/paragraphs leave target empty.'},
      {role:'user',content:JSON.stringify({authorRequest,documentIdentity:identity,paragraphCount:paragraphs.length})},
    ],{
      name:'submit_edit_location',label:'Locate the author-authorized edit',description:'Resolve the author location without reading or rewriting the prose.',parameters:LocationSchema,
      validate:location=>{
        const valid=location.kind==='paragraphs'
          ? location.boundary!=='none'&&location.count>=1&&location.count<=paragraphs.length&&!location.target.trim()
          : location.boundary==='none'&&location.count===0&&(location.kind==='reference'?Boolean(location.target.trim()):!location.target.trim());
        if(!valid)throw Object.assign(new Error('Use one valid location: a bounded first/last paragraph count, the complete document, or a qualified source reference.'),{code:'EDIT_LOCATION_INVALID'});
        return location;
      },
    },{maxTokens:Math.min(2048,this.ctx.client.defaults.maxTokens),professionalGuidance:false});
    recordExecutionEvidence('edit-location-resolved',{identity,location});
    if(location.kind==='document')return{wholeDocument:true,selections:[],reason:'Author permits the complete supplied document.'};
    if(location.kind==='paragraphs'){
      const selected=location.boundary==='first'?paragraphs.slice(0,location.count):paragraphs.slice(-location.count);
      return{wholeDocument:false,selections:selected.map(unit=>({unitId:unit.id,text:''})),reason:`Author requested ${location.boundary} ${location.count} paragraph(s) of the supplied document.`};
    }
    const request=authorTextScopeRequest(content,location.target);
    const selected=await this.submitStructured(request.messages,request.tool,{maxTokens:Math.min(8192,this.ctx.client.defaults.maxTokens),professionalGuidance:false});
    return selected.result;
  }
}
