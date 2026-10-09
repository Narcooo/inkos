import {Type,type Static} from '@sinclair/typebox';
import {splitSourceLines} from '../utils/source-text.js';
import {TextEditSelectionSchema,textRangeEditContract,textScopedSelectionEditContract} from '../utils/text-range-edits.js';

const Scope=Type.Object({wholeDocument:Type.Boolean(),selections:Type.Array(TextEditSelectionSchema),reason:Type.String({description:'Briefly identify the source unit and protected boundaries matched by these selections.'})},{additionalProperties:false});

/** Scope interpretation sees original author intent and source only, never a
 * coordinator's proposed workaround or pressure to satisfy another constraint. */
export function authorTextScopeRequest(content:string,authorRequest:string){
  return{
    messages:[
      {role:'system' as const,content:'Your sole task is source navigation, not creative improvement. Identify the smallest exact source unit matching the author’s location and extent, without rewriting it. The desired creative effect does not grant permission to select additional units. Ignore whether the selected passage alone makes that effect easy to achieve. The complete numbered document supplies context. Select only the requested units and content kinds. Return the exact editable source text and its inclusive line bounds to disambiguate repeated phrases. Exclude surrounding labels, formatting and protected text, including stage directions sharing a line with dialogue when only dialogue is editable. Use separate selections where protected text intervenes. Set wholeDocument=true with no selections only when the author permits revising the entire document.'},
      {role:'user' as const,content:JSON.stringify({authorRequest,document:splitSourceLines(content).map((text,index)=>({line:index+1,text}))})},
    ],
    tool:{name:'submit_author_edit_scope',label:'Locate authorized text',description:'Identify editable source ranges from the original author request, without proposed prose.',parameters:Scope,
      validate:(result:Static<typeof Scope>)=>{authorTextScopeContract(content,result);return result;},
    },
  };
}

export function authorTextScopeContract(content:string,result:Static<typeof Scope>){
  if(result.wholeDocument){
    if(result.selections.length)throw new Error('Whole-document scope must not also select partial text');
    return textRangeEditContract(content,[{startLine:1,endLine:splitSourceLines(content).length}]);
  }
  return textScopedSelectionEditContract(content,result.selections);
}
