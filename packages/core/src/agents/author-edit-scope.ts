import {Type,type Static} from '@sinclair/typebox';
import {splitSourceLines} from '../utils/source-text.js';
import {textRangeEditContract,textScopedSelectionEditContract} from '../utils/text-range-edits.js';

const Scope=Type.Object({
  wholeDocument:Type.Boolean(),
  selections:Type.Array(Type.Object({
    unitId:Type.String({description:'A paragraph or line ID supplied in the document.'}),
    text:Type.String({description:'Empty selects the complete source unit. For a partial-line edit, copy only the exact editable substring.'}),
  },{additionalProperties:false})),
  reason:Type.String({description:'Identify the author-authorized units and protected boundaries.'}),
},{additionalProperties:false});

/** Present source text once, with stable paragraph and line addresses. The
 * model selects addresses instead of reproducing whole paragraphs and bounds. */
function sourceUnits(content:string){
  const paragraphs:Array<{id:string;lines:Array<{id:string;text:string}>}>=[];
  const byId=new Map<string,{startLine:number;endLine:number;text:string}>();
  let paragraph:typeof paragraphs[number]|undefined;
  splitSourceLines(content).forEach((text,index)=>{
    if(!text.trim()){paragraph=undefined;return;}
    if(!paragraph){
      paragraph={id:`p${paragraphs.length+1}`,lines:[]};
      paragraphs.push(paragraph);
    }
    const line={id:`${paragraph.id}.l${paragraph.lines.length+1}`,text};
    paragraph.lines.push(line);
    byId.set(line.id,{startLine:index+1,endLine:index+1,text});
    const previous=byId.get(paragraph.id);
    byId.set(paragraph.id,{startLine:previous?.startLine??index+1,endLine:index+1,text:(previous?.text??'')+text});
  });
  return{paragraphs,byId};
}

/** Scope interpretation sees original author intent and source only, never a
 * coordinator's proposed workaround or pressure to satisfy another constraint. */
export function authorTextScopeRequest(content:string,authorRequest:string){
  return{
    messages:[
      {role:'system' as const,content:'Locate the smallest exact source units authorized by the author; do not rewrite them. The numbered paragraphs contain individual lines, each with a supplied ID. Select paragraph IDs for entire paragraphs, line IDs for entire lines, and an exact substring within a selected line only for inline edits. An empty selection text means the complete selected unit. Preserve labels, stage directions and surrounding text when only dialogue is requested. The desired creative effect does not authorize selecting extra units. Use wholeDocument=true with no selections only when the author permits rewriting everything.'},
      {role:'user' as const,content:JSON.stringify({authorRequest,document:sourceUnits(content).paragraphs})},
    ],
    tool:{name:'submit_author_edit_scope',label:'Locate authorized source units',description:'Select existing source IDs, with an exact substring only for a partial-line edit.',parameters:Scope,
      validate:(result:Static<typeof Scope>)=>{authorTextScopeContract(content,result);return result;},
    },
  };
}

export function authorTextScopeContract(content:string,result:Static<typeof Scope>){
  if(result.wholeDocument){
    if(result.selections.length)throw new Error('Whole-document scope must not also select partial text');
    return textRangeEditContract(content,[{startLine:1,endLine:splitSourceLines(content).length}]);
  }
  const {byId}=sourceUnits(content);
  const selections=result.selections.map(selection=>{
    const unit=byId.get(selection.unitId);
    if(!unit)throw Object.assign(new Error('Choose an existing paragraph or line ID from the supplied document.'),{code:'ARTIFACT_EDIT_TARGET_NOT_FOUND'});
    return{...unit,text:selection.text||unit.text};
  });
  return textScopedSelectionEditContract(content,selections);
}
