import type { Calibration } from './domain';

type Label={text:string;bounds:[number,number,number,number]};
const printed=/^(?:scale\s*:?\s*)?(?:(\d+)\s+)?(\d+)\s*(?:\/\s*(\d+))?\s*"\s*=\s*(\d+)\s*'\s*(?:-?\s*(\d+(?:\.\d+)?)\s*")?$/i;

export function printedScale(labels:Label[],width:number,height:number):Calibration|undefined {
  const clean=(text:string)=>text.trim().replace(/[“”″]/g,'"').replace(/[‘’′]/g,"'");
  // A single plan caption is required. Extra scale captions indicate multiple views.
  if(labels.some(({text})=>/^(?:scale\s*:?\s*)?(?:n\.?\s*t\.?\s*s\.?|not to scale|as indicated|varies)$/i.test(clean(text))))return;
  const possible=labels.filter(({text})=>/^(?:scale\s*:?\s*)?\d.*(?:=|^\d+\s*:\s*\d+$)/i.test(clean(text)));
  if(possible.length!==1)return;
  const label=possible[0], text=clean(label.text), match=printed.exec(text);
  if(!match||!labels.some(other=>other!==label&&/\b(?:floor plan|demolition floor plan|ceiling plan|site plan|demo(?:lition)? plan|roof plan|foundation plan)\b/i.test(other.text)&&
    other.text.length<100&&Math.abs(other.bounds[0]-label.bounds[0])<=115&&
    Math.abs(other.bounds[1]-label.bounds[1])<=40))return;
  const inches=Number(match[1]??0)+Number(match[2])/Number(match[3]??1);
  const feet=Number(match[4])+Number(match[5]??0)/12;
  const points=inches*72;
  if(!Number.isFinite(points)||points<=0||points>width||feet<=0||height<=0)return;
  return {points:[[0,0],[points,0]],feet,source:`Printed scale: ${text}`};
}
