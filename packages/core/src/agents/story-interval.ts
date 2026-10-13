import {Type} from '@sinclair/typebox';
import {Value} from '@sinclair/typebox/value';
import type {AgentTool} from '@mariozechner/pi-agent-core';

const Point=Type.Object({
  clock:Type.String({minLength:1,description:'The explicitly established common origin of these week numbers. Project weeks and employment weeks are different clocks unless their origins have been reconciled from the text.'}),
  week:Type.Integer({minimum:1,maximum:10000}),
  weekday:Type.Integer({minimum:1,maximum:7,description:'Monday=1 through Sunday=7.'}),
  minuteOfDay:Type.Optional(Type.Integer({minimum:0,maximum:1439,description:'Hour*60+minute, only when both event times are known. Omit for day precision.'})),
},{additionalProperties:false});
const Parameters=Type.Object({start:Point,end:Point},{additionalProperties:false});

/** Local arithmetic on stated relative dates; this does not establish fictional facts. */
export function createStoryIntervalTool():AgentTool{
  return {name:'calculate_story_interval',label:'Calculate story interval',parameters:Parameters,
    description:'Compute elapsed time between two events on the same established week clock, including weekday and optional time of day. Read the source anchors first. Missing or incompatible anchors cannot be resolved by subtracting week numbers. The result verifies arithmetic, not the truth of the selected dates.',
    async execute(_id,input){
      const {start,end}=Value.Parse(Parameters,input);
      if(!start.clock.trim()||start.clock.trim()!==end.clock.trim())throw Object.assign(new Error('Relate the two clock origins using source evidence before comparing the dates.'),{code:'STORY_INTERVAL_CLOCK_MISMATCH'});
      if((start.minuteOfDay===undefined)!==(end.minuteOfDay===undefined))throw Object.assign(new Error('Use the same precision for both endpoints; an unknown time is not midnight.'),{code:'STORY_INTERVAL_PRECISION_MISMATCH'});
      const coordinate=(point:typeof start)=>((point.week-1)*7+point.weekday-1)*1440+(point.minuteOfDay??0);
      const minutes=coordinate(end)-coordinate(start),absolute=Math.abs(minutes);
      const receipt={kind:'story_interval',start,end,precision:start.minuteOfDay===undefined?'days':'minutes',direction:Math.sign(minutes),
        elapsedMinutes:minutes,elapsedDays:minutes/1440,
        magnitude:{weeks:Math.floor(absolute/10080),days:Math.floor(absolute%10080/1440),hours:Math.floor(absolute%1440/60),minutes:absolute%60},
        exactWholeWeeks:minutes%10080===0};
      return {content:[{type:'text',text:JSON.stringify(receipt)}],details:receipt};
    }};
}
