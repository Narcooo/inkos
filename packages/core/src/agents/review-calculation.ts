import {Type} from '@sinclair/typebox';
import {Value} from '@sinclair/typebox/value';
import type {AgentTool} from '@mariozechner/pi-agent-core';

const Parameters=Type.Object({
  operation:Type.Union([Type.Literal('add'),Type.Literal('subtract'),Type.Literal('multiply'),Type.Literal('divide')]),
  values:Type.Array(Type.Number(),{minItems:2,maxItems:64,description:'Values in the same units, applied left to right. Negative values can represent deductions.'}),
},{additionalProperties:false});

/** Arithmetic evidence is computed locally; interpreting its source remains
 * the reviewer's responsibility. No code or expressions are evaluated. */
export function createReviewCalculationTool():AgentTool{
  return {
    name:'calculate_review_values',label:'Calculate review values',parameters:Parameters,
    description:'Calculate a total, difference, product or ratio before making an arithmetic finding. Select values from the source and keep units and time periods consistent. This verifies arithmetic only, not the choice of operands or their interpretation.',
    async execute(_id,input){
      const {operation,values}=Value.Parse(Parameters,input);
      const invalid=()=>Object.assign(new Error('Supply finite values and a defined finite arithmetic result.'),{code:'REVIEW_CALCULATION_UNDEFINED'});
      if(values.length<2||values.length>64||values.some(value=>!Number.isFinite(value)))throw invalid();
      let result=values[0]!;
      for(const value of values.slice(1)){
        if(operation==='add')result+=value;
        else if(operation==='subtract')result-=value;
        else if(operation==='multiply')result*=value;
        else if(operation==='divide'){if(value===0)throw invalid();result/=value;}
        else throw invalid();
      }
      if(!Number.isFinite(result))throw invalid();
      const receipt={kind:'review_calculation',operation,values,result};
      return {content:[{type:'text',text:JSON.stringify(receipt)}],details:receipt};
    },
  };
}
