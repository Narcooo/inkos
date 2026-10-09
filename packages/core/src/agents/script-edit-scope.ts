import {Type,type Static} from '@sinclair/typebox';
import {sourceUnits,AuthorTextScopeSchema,authorTextScopeContract,AUTHOR_TARGET_AUTHORITY,type AuthorTextScope} from './author-edit-scope.js';

const ScriptScope=Type.Object({
  speakerIds:Type.Array(Type.String({description:'IDs of speakers whose spoken text is selected. Empty when no spoken text is selected, or for an authorized whole-document rewrite.'})),
  ...AuthorTextScopeSchema.properties,
},{additionalProperties:false});

/** Index the Markdown speaker blocks emitted by the script producer. Unknown
 * formats keep the general source selector; this index never rewrites text. */
export function scriptDialogueIndex(content:string){
  const {paragraphs}=sourceUnits(content);
  const cast:Array<{id:string;name:string;description:string;sourceUnitId?:string}>=[];
  const castParagraphIds=new Set<string>();
  const sameName=(left:string,right:string|undefined)=>left.toLocaleLowerCase()===right?.toLocaleLowerCase();
  let castSectionDepth:number|undefined;
  let currentCharacter:typeof cast[number]|undefined;
  for(const paragraph of paragraphs){
    const line=paragraph.lines[0]!;
    const heading=line.text.trim().match(/^(#{1,6})\s+(.+?)(?:\s+#+)?$/u);
    if(heading){
      if(castSectionDepth!==undefined&&heading[1]!.length<=castSectionDepth)castSectionDepth=undefined;
      if(/^(?:人物|人物表|人物介绍|角色|角色表|角色介绍|cast|characters)$/iu.test(heading[2]!))castSectionDepth=heading[1]!.length;
      currentCharacter=undefined;
      if(castSectionDepth!==undefined)castParagraphIds.add(paragraph.id);
      continue;
    }
    const definition=line.text.trim().match(/^\*\*([^*]+)\*\*(?:\s+(.+))?$/u);
    if(castSectionDepth!==undefined){
      castParagraphIds.add(paragraph.id);
      if(definition){
        currentCharacter=cast.find(character=>sameName(character.name,definition[1]));
        if(!currentCharacter){
          currentCharacter={id:`speaker-${cast.length+1}`,name:definition[1]!,description:[definition[2],...paragraph.lines.slice(1).map(item=>item.text.trim())].filter(Boolean).join('\n'),sourceUnitId:line.id};
          cast.push(currentCharacter);
        }
      }else if(currentCharacter){
        currentCharacter.description=[currentCharacter.description,...paragraph.lines.map(item=>item.text.trim())].filter(Boolean).join('\n');
      }
      continue;
    }
    // Legacy scripts put inline cast definitions before the first scene.
    if(definition&&!definition[2])break;
    if(definition&&!cast.some(character=>sameName(character.name,definition[1]))){
      cast.push({id:`speaker-${cast.length+1}`,name:definition[1]!,description:definition[2]!,sourceUnitId:line.id});
      castParagraphIds.add(paragraph.id);
    }
  }
  const labels=new Map<string,number>();
  for(const paragraph of paragraphs){
    if(castParagraphIds.has(paragraph.id))continue;
    const label=paragraph.lines[0]!.text.trim().match(/^\*\*([^*]+)\*\*$/u)?.[1];
    if(label)labels.set(label,(labels.get(label)??0)+1);
  }
  for(const [name,count] of labels)if(count>1&&!cast.some(character=>sameName(character.name,name))){
    cast.push({id:`speaker-${cast.length+1}`,name,description:'Repeated speaker label; no separate cast definition supplied.'});
  }
  const dialogue:Array<{id:string;speakerId:string;scene:string;speechBlock:number;precedingDirection:string;text:string}>=[];
  let scene='',precedingDirection='',speechBlock=0,inDialogue=false;
  for(const paragraph of paragraphs){
    if(castParagraphIds.has(paragraph.id))continue;
    const label=paragraph.lines[0]!.text.trim().match(/^\*\*([^*]+)\*\*$/u)?.[1];
    const speaker=cast.find(character=>sameName(character.name,label));
    if(label&&!speaker){scene=label;inDialogue=false;precedingDirection='';continue;}
    if(!speaker){inDialogue=false;precedingDirection=paragraph.lines.map(line=>line.text).join('');continue;}
    const spoken=paragraph.lines.slice(1).filter(line=>!/^[（(].*[）)]\s*$/u.test(line.text.trim()));
    if(!spoken.length){inDialogue=false;continue;}
    if(!inDialogue)speechBlock++;
    inDialogue=true;
    for(const line of spoken){
      dialogue.push({id:line.id,speakerId:speaker.id,scene,speechBlock,precedingDirection,text:line.text});
    }
  }
  return {cast,dialogue,castParagraphIds};
}

export function scriptDialogueScopeRequest(content:string,authorRequest:string){
  const catalog=scriptDialogueIndex(content);
  if(!catalog.cast.length||!catalog.dialogue.length)return undefined;
  const {paragraphs}=sourceUnits(content);
  const speechById=new Map(catalog.dialogue.map(line=>[line.id,line]));
  const units=paragraphs.flatMap(paragraph=>{
    const spoken=paragraph.lines.some(line=>speechById.has(line.id));
    if(spoken)return paragraph.lines.map(line=>{
      const speech=speechById.get(line.id);
      return {id:line.id,kind:speech?'dialogue':line===paragraph.lines[0]?'speaker_label':'stage_direction',...speech,text:line.text};
    });
    return [{id:paragraph.id,kind:catalog.castParagraphIds.has(paragraph.id)?'cast_definition':'stage_or_heading',text:paragraph.lines.map(line=>line.text).join('')}];
  });
  const byId=new Map(units.map(unit=>[unit.id,unit]));
  const validate=(result:Static<typeof ScriptScope>)=>{
    if(result.selections.some(selection=>!byId.has(selection.unitId)))throw Object.assign(new Error(JSON.stringify({code:'SCRIPT_SCOPE_UNIT_INVALID',instruction:'Choose only the supplied unit IDs. Mixed speaker paragraphs have separate label, direction and dialogue lines; do not select their parent paragraph.'})),{code:'SCRIPT_SCOPE_UNIT_INVALID'});
    const selectedSpeakers=new Set(result.selections.flatMap(selection=>{
      const speech=speechById.get(selection.unitId);return speech?[speech.speakerId]:[];
    }));
    if(result.speakerIds.length!==selectedSpeakers.size||result.speakerIds.some(id=>!selectedSpeakers.has(id)))throw Object.assign(new Error(JSON.stringify({code:'SCRIPT_SCOPE_SPEAKER_MISMATCH',instruction:'Declare exactly the speakers whose dialogue is selected. Match the requested names or occupations to the cast before choosing speech. Whole-document scope uses no speaker or selection IDs.'})),{code:'SCRIPT_SCOPE_SPEAKER_MISMATCH'});
    authorTextScopeContract(content,result);
    return result;
  };
  return {
    messages:[
      {role:'system' as const,content:`Locate only the text edits authorized by the original request; do not rewrite anything. ${AUTHOR_TARGET_AUTHORITY} Resolve requested speakers through the cast definitions, not a character’s prominence or dramatic arc. Each source unit is labelled as dialogue, speaker label, stage direction or other text. For dialogue-only requests select spoken text, preserving labels and stage directions. speechBlock groups consecutive speakers separated by a stage direction; use scene and block order to locate a requested final exchange. Emotional effect or a concrete choice does not authorize extra actions. Review, export, saving and version retention are separate operations, not permission to select more text. Use wholeDocument only for an explicitly authorized whole-document rewrite.`},
      {role:'user' as const,content:JSON.stringify({authorRequest,cast:catalog.cast,sourceUnits:units})},
    ],
    tool:{name:'submit_script_edit_scope',label:'Locate script edit scope',description:'Bind author-requested script edits to speaker identities and typed source units.',parameters:ScriptScope,validate},
    toAuthorScope(result:Static<typeof ScriptScope>):AuthorTextScope{
      validate(result);
      return {wholeDocument:result.wholeDocument,selections:result.selections,reason:result.reason};
    },
  };
}
