import {Type,type Static} from '@sinclair/typebox';
import {sourceUnits,AuthorTextScopeSchema,authorTextScopeContract,AUTHOR_TARGET_AUTHORITY,type AuthorTextScope} from './author-edit-scope.js';
import {splitSourceLines} from '../utils/source-text.js';

const ScriptScope=Type.Object({
  speakerIds:Type.Array(Type.String({description:'IDs of speakers whose spoken text is selected. Empty when no spoken text is selected, or for an authorized whole-document rewrite.'})),
  speechPosition:Type.Optional(Type.Object({
    scene:Type.String({description:'Exact scene label from the indexed dialogue.'}),
    position:Type.Union([Type.Literal('first'),Type.Literal('last')]),
  },{additionalProperties:false,description:'Only for the first or last individual speech of one selected speaker in a scene. Leave selections empty. For a conversation or exchange, select its spoken source units from context instead; intervening stage directions do not define an exchange boundary.'})),
  ...Type.Omit(AuthorTextScopeSchema,['focus']).properties,
},{additionalProperties:false});

/** Index the Markdown speaker blocks emitted by the script producer. Unknown
 * formats keep the general source selector; this index never rewrites text. */
export function scriptDialogueIndex(content:string){
  const {paragraphs}=sourceUnits(content);
  const leadingDirection=(text:string)=>text.match(/^(?:[ \t]*[（(][^）)\n]*[）)])+[ \t]*/u)?.[0]??'';
  const inlineSpeech=(text:string)=>{
    const ending=text.match(/\r?\n$/u)?.[0]??'';
    const line=text.slice(0,text.length-ending.length),colon=line.search(/[:：]/u);
    if(colon<0)return undefined;
    let name=line.slice(0,colon).trim(),start=colon+1;
    // Markdown emphasis may wrap the name alone or include its colon. Keep
    // those delimiters in the protected source label, not the editable speech.
    for(const marker of ['**','__','*','_']){
      if(name.startsWith(marker)&&!name.endsWith(marker)&&line.slice(start).startsWith(marker)){
        name=name.slice(marker.length);start+=marker.length;break;
      }
    }
    name=name.replace(/[（(][^）)\n]*[）)]\s*$/u,'').trim().replace(/^(\*\*|__|\*|_)(.*?)\1$/u,'$2');
    if(!name||/[:：\n()（）*]/u.test(name))return undefined;
    start+=line.slice(start).match(/^[ \t]*/u)![0].length;
    const direction=leadingDirection(line.slice(start));
    const spoken=line.slice(start+direction.length);
    if(!spoken.trim())return undefined;
    return {name,label:line.slice(0,start),direction,text:spoken};
  };
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
    const definition=line.text.trim().match(/^\*\*([^*]+)\*\*(.*)$/u);
    if(definition)definition[2]=definition[2]!.trim();
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
    for(const line of paragraph.lines){const inline=inlineSpeech(line.text);if(inline)labels.set(inline.name,(labels.get(inline.name)??0)+1);}
  }
  for(const [name,count] of labels)if(count>1&&!cast.some(character=>sameName(character.name,name))){
    cast.push({id:`speaker-${cast.length+1}`,name,description:'Repeated speaker label; no separate cast definition supplied.'});
  }
  const dialogue:Array<{id:string;speakerId:string;scene:string;speechId:string;precedingDirection:string;text:string;sourceUnitId?:string;label?:string;direction?:string}>=[];
  let scene='',precedingDirection='';
  for(const paragraph of paragraphs){
    if(castParagraphIds.has(paragraph.id))continue;
    const label=paragraph.lines[0]!.text.trim().match(/^\*\*([^*]+)\*\*$/u)?.[1];
    const speaker=cast.find(character=>sameName(character.name,label));
    if(label&&!speaker){scene=label;precedingDirection='';continue;}
    if(!speaker){
      for(const line of paragraph.lines){
        const inline=inlineSpeech(line.text),inlineSpeaker=inline&&cast.find(character=>sameName(character.name,inline.name));
        if(!inline||!inlineSpeaker){precedingDirection=line.text;continue;}
        dialogue.push({id:`${line.id}.speech`,sourceUnitId:line.id,speakerId:inlineSpeaker.id,scene,speechId:line.id,
          precedingDirection:precedingDirection+inline.direction,text:inline.text,label:inline.label,direction:inline.direction});
      }
      continue;
    }
    const spoken=paragraph.lines.slice(1).filter(line=>!/^[（(].*[）)]\s*$/u.test(line.text.trim()));
    if(!spoken.length)continue;
    for(const line of spoken){
      const direction=leadingDirection(line.text);
      if(direction){
        const ending=line.text.match(/\r?\n$/u)?.[0]??'';
        dialogue.push({id:`${line.id}.speech`,sourceUnitId:line.id,speakerId:speaker.id,scene,speechId:paragraph.id,
          precedingDirection:precedingDirection+direction,label:'',direction,text:line.text.slice(direction.length,line.text.length-ending.length)});
      }else dialogue.push({id:line.id,sourceUnitId:line.id,speakerId:speaker.id,scene,speechId:paragraph.id,precedingDirection,text:line.text.replace(/\r?\n$/u,'')});
    }
  }
  return {cast,dialogue,castParagraphIds};
}

/** Carry the indexed speaker identity into each writing slot. Numeric ranges
 * enforce bytes; they do not tell a writer whose words those bytes represent. */
export function scriptSelectionContexts(content:string,ranges:readonly {startOffset:number;endOffset:number}[]){
  const catalog=scriptDialogueIndex(content),{byId}=sourceUnits(content);
  const offsets=[0];for(const line of splitSourceLines(content))offsets.push(offsets.at(-1)!+line.length);
  const speeches=catalog.dialogue.map(speech=>{
    const unit=byId.get(speech.sourceUnitId??speech.id)!;
    const startOffset=offsets[unit.startLine-1]!+(speech.label?.length??0)+(speech.direction?.length??0);
    return{...speech,startOffset,endOffset:startOffset+speech.text.length};
  });
  return ranges.map(range=>{
    const speech=speeches.find(speech=>range.startOffset>=speech.startOffset&&range.endOffset<=speech.endOffset);
    if(!speech)return undefined;
    const speaker=catalog.cast.find(speaker=>speaker.id===speech.speakerId)!;
    return{kind:'dialogue' as const,speakerId:speaker.id,speakerName:speaker.name,speakerDescription:speaker.description,scene:speech.scene};
  });
}

/** Resolve named identities before narrative prominence can bias the edit. */
export function scriptSubjectRequest(content:string,authorRequest:string){
  const {cast,dialogue}=scriptDialogueIndex(content);
  if(!cast.length||!dialogue.length)return undefined;
  return{
    messages:[
      {role:'system' as const,content:'Identify only the characters explicitly singled out by the author as the subject of the requested change. Resolve names or occupations using the supplied cast, not dramatic prominence. Return their cast IDs. Return an empty array if no character is singled out. Do not locate text or plan a rewrite.'},
      {role:'user' as const,content:JSON.stringify({authorRequest,cast})},
    ],
    tool:{name:'resolve_script_subjects',label:'Resolve requested characters',description:'Resolve author-named identities before selecting dialogue.',
      parameters:Type.Object({focusSpeakerIds:Type.Array(Type.String())},{additionalProperties:false}),
      validate:(result:{focusSpeakerIds:string[]})=>{
        if(result.focusSpeakerIds.some(id=>!cast.some(speaker=>speaker.id===id)))throw Object.assign(new Error('Choose only cast IDs supplied for the original author request.'),{code:'SCRIPT_SCOPE_FOCUS_INVALID'});
        return result;
      },
    },
  };
}

export function scriptDialogueScopeRequest(content:string,authorRequest:string,focusSpeakerIds:readonly string[]=[]){
  const catalog=scriptDialogueIndex(content);
  if(!catalog.cast.length||!catalog.dialogue.length)return undefined;
  const {paragraphs}=sourceUnits(content);
  const speechById=new Map(catalog.dialogue.map(line=>[line.id,line]));
  const inlineByLine=new Map(catalog.dialogue.filter(line=>line.sourceUnitId).map(line=>[line.sourceUnitId!,line]));
  const units=paragraphs.flatMap(paragraph=>{
    const spoken=paragraph.lines.some(line=>speechById.has(line.id)||inlineByLine.has(line.id));
    if(spoken)return paragraph.lines.flatMap(line=>{
      const inline=inlineByLine.get(line.id);
      if(inline)return [
        ...(inline.label?[{id:`line-${line.id}-speaker`,kind:'speaker_label',sourceUnitId:line.id,text:inline.label}]:[]),
        ...(inline.direction?[{id:`line-${line.id}-direction`,kind:'stage_direction',sourceUnitId:line.id,text:inline.direction}]:[]),
        {...inline,kind:'dialogue'},
      ];
      const speech=speechById.get(line.id);
      return [{id:line.id,kind:speech?'dialogue':line===paragraph.lines[0]?'speaker_label':'stage_direction',...speech,text:line.text}];
    });
    return [{id:paragraph.id,kind:catalog.castParagraphIds.has(paragraph.id)?'cast_definition':'stage_or_heading',text:paragraph.lines.map(line=>line.text).join('')}];
  });
  const byId=new Map(units.map(unit=>[unit.id,unit]));
  const selectionsFor=(result:Static<typeof ScriptScope>)=>{
    if(!result.speechPosition)return result.selections;
    if(result.wholeDocument||result.selections.length||result.speakerIds.length!==1)throw Object.assign(new Error('A positional speech selection requires exactly one speaker and no additional source selections.'),{code:'SCRIPT_SCOPE_POSITION_INVALID'});
    const position=result.speechPosition;
    const candidates=catalog.dialogue.filter(line=>line.scene===position.scene&&result.speakerIds.includes(line.speakerId));
    const edge=position.position==='first'?candidates[0]:candidates.at(-1);
    if(!edge)throw Object.assign(new Error('Choose a supplied scene and speaker combination containing dialogue.'),{code:'SCRIPT_SCOPE_POSITION_INVALID'});
    return candidates.filter(line=>line.speechId===edge.speechId).map(line=>({unitId:line.id,text:''}));
  };
  const toAuthorScope=(result:Static<typeof ScriptScope>):AuthorTextScope=>({
    wholeDocument:result.wholeDocument,reason:result.reason,
    ...(focusSpeakerIds.length?{focus:focusSpeakerIds.map(id=>{
      const speaker=catalog.cast.find(speaker=>speaker.id===id)!;
      return{id:speaker.id,name:speaker.name,description:speaker.description};
    })}:{}),
    selections:selectionsFor(result).map(selection=>{
      const unit=byId.get(selection.unitId);
      if(unit&&'sourceUnitId' in unit&&unit.sourceUnitId){
        const text=selection.text||unit.text;
        if(!unit.text.includes(text))throw Object.assign(new Error('Select text within the addressed script segment.'),{code:'SCRIPT_SCOPE_SEGMENT_INVALID'});
        return {unitId:unit.sourceUnitId,text};
      }
      return selection;
    }),
  });
  const validate=(result:Static<typeof ScriptScope>)=>{
    const selections=selectionsFor(result);
    if(selections.some(selection=>!byId.has(selection.unitId)))throw Object.assign(new Error(JSON.stringify({code:'SCRIPT_SCOPE_UNIT_INVALID',instruction:'Choose only the supplied unit IDs. Mixed speaker paragraphs have separate label, direction and dialogue lines; do not select their parent paragraph.'})),{code:'SCRIPT_SCOPE_UNIT_INVALID'});
    const selectedSpeakers=new Set(selections.flatMap(selection=>{
      const speech=speechById.get(selection.unitId);return speech?[speech.speakerId]:[];
    }));
    if(result.speakerIds.length!==selectedSpeakers.size||result.speakerIds.some(id=>!selectedSpeakers.has(id)))throw Object.assign(new Error(JSON.stringify({code:'SCRIPT_SCOPE_SPEAKER_MISMATCH',instruction:'Declare exactly the speakers whose dialogue is selected. Match the requested names or occupations to the cast before choosing speech. Whole-document scope uses no speaker or selection IDs.'})),{code:'SCRIPT_SCOPE_SPEAKER_MISMATCH'});
    authorTextScopeContract(content,toAuthorScope(result));
    return result;
  };
  return {
    messages:[
      {role:'system' as const,content:`Locate only the text edits authorized by the original request; do not rewrite anything. ${AUTHOR_TARGET_AUTHORITY} Resolve requested speakers through the cast definitions, not a character’s prominence or dramatic arc. Each source unit is labelled as dialogue, speaker label, stage direction or other text. For dialogue-only requests select spoken text, preserving labels and stage directions. A conversation or exchange is a contextual unit: select its authorized spoken source units even when stage directions intervene. A pause, gesture or intervening action does not by itself start a new exchange. For an explicitly requested first/last individual speech of one speaker within a scene, use speechPosition and leave selections empty; the host resolves source order and includes all lines of that speech. Use exact source selections for other edits. Emotional effect or a concrete choice does not authorize extra actions. Review, export, saving and version retention are separate operations, not permission to select more text. Use wholeDocument only for an explicitly authorized whole-document rewrite.`},
      {role:'user' as const,content:JSON.stringify({authorRequest,cast:catalog.cast,authorFocus:catalog.cast.filter(speaker=>focusSpeakerIds.includes(speaker.id)),sourceUnits:units})},
    ],
    tool:{name:'submit_script_edit_scope',label:'Locate script edit scope',description:'Bind author-requested script edits to speaker identities and typed source units.',parameters:ScriptScope,validate},
    toAuthorScope(result:Static<typeof ScriptScope>):AuthorTextScope{
      validate(result);
      return toAuthorScope(result);
    },
  };
}
