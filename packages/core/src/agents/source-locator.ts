import {Type} from '@sinclair/typebox';
import {BaseAgent} from './base.js';
import {authorTextScopeRequest,sourceUnits,mergeAuthorTextScopes,type AuthorTextScope} from './author-edit-scope.js';
import {recordExecutionEvidence} from '../harness/execution-evidence.js';

const LocationSchema=Type.Object({
  kind:Type.Union([Type.Literal('document'),Type.Literal('paragraphs'),Type.Literal('reference')]),
  boundary:Type.Union([Type.Literal('first'),Type.Literal('last'),Type.Literal('none')]),
  count:Type.Integer({minimum:0}),
  targets:Type.Array(Type.Object({quote:Type.String({minLength:1,description:'Exact author wording authorizing this target.'}),target:Type.String({minLength:1,description:'One independent requested target, with identity and scope qualifiers, not replacement prose.'})},{additionalProperties:false}),{description:'For reference scope, list each distinct target separately. For document/paragraphs use an empty array.'}),
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
      {role:'system',content:'Identify only the location the author permits editing. Do not plan replacement prose. The supplied identity describes the complete document available for this operation; other documents named in the request are not inside it. Use paragraphs only for explicit first/last paragraph counts, and document only for unrestricted rewriting of this document. Otherwise use reference. For document/reference set boundary=none and count=0; document/paragraphs have targets=[].'},
      {role:'system',content:'Reference scope must enumerate each independent requested target, with an exact quote from the author request. Split a request for several corrections into separate targets instead of one summary. Include a fact requested across chapters unless the author explicitly limits it to another document; the next step will determine whether it is present here. Editing selected facts throughout a chapter is reference scope, not document scope. A chapter number is not a paragraph count; an independent opening and a chapter title are separate from chapter prose. Preserve all restrictions on identity, location and surrounding text.'},
      {role:'user',content:JSON.stringify({authorRequest,documentIdentity:identity,paragraphCount:paragraphs.length})},
    ],{
      name:'submit_edit_location',label:'Locate the author-authorized edit',description:'Resolve the author location without reading or rewriting the prose.',parameters:LocationSchema,
      validate:location=>{
        const valid=location.kind==='paragraphs'
          ? location.boundary!=='none'&&location.count>=1&&location.count<=paragraphs.length&&location.targets.length===0
          : location.boundary==='none'&&location.count===0&&(location.kind==='reference'?location.targets.length>0:location.targets.length===0);
        if(location.targets.some(target=>!authorRequest.includes(target.quote)))throw Object.assign(new Error('Each target must quote the original author request exactly.'),{code:'EDIT_TARGET_AUTHORITY_MISSING'});
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
    const request=authorTextScopeRequest(content,authorRequest,identity);
    const targets=location.targets.map((target,index)=>({id:`target_${index}`,...target}));
    const part=Type.Object({selections:Type.Array(Type.Object({unitId:Type.String(),text:Type.String({minLength:1,description:'Copy only the exact author-editable source text. A containing sentence is not permission to rewrite that sentence. Do not use an empty-string whole-unit shortcut.'})},{additionalProperties:false})),reason:Type.String()},{additionalProperties:false});
    const selected=await this.submitStructured([...request.messages.slice(0,-1),
      {role:'system',content:'Locate each target independently against the entire supplied document. Return an entry for every target. Select all its authorized occurrences; keep unrelated characters protected. If a target is absent here, return empty selections and explain its absence. Targets are additive, not an intersection. Do not let one target suppress another.'},
      {role:'user',content:JSON.stringify({...JSON.parse(request.messages.at(-1)!.content),targets})},
    ],{name:'submit_author_target_scopes',label:'Locate every requested target',description:'Return source selections or an absence explanation for every requested target.',
      parameters:Type.Object(Object.fromEntries(targets.map(target=>[target.id,part])),{additionalProperties:false}),
      validate:result=>{mergeAuthorTextScopes(content,targets.map(target=>({wholeDocument:false,...result[target.id]!})));return result;},
    },{maxTokens:Math.min(8192,this.ctx.client.defaults.maxTokens),professionalGuidance:false});
    const scopes=targets.map(target=>({wholeDocument:false,...selected.result[target.id]!}));
    recordExecutionEvidence('edit-targets-selected',{identity,targets:targets.map((target,index)=>({...target,...scopes[index]}))});
    const merged=mergeAuthorTextScopes(content,scopes);
    if(!merged.selections.length)throw Object.assign(new Error('None of the requested targets occurs in the supplied document. Select the correct source instead of widening the edit.'),{code:'ARTIFACT_EDIT_TARGET_NOT_FOUND',identity,targets});
    return merged;
  }
}
