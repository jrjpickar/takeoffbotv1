import type { Calibration } from './domain';

type Label={text:string;bounds:[number,number,number,number]};
const architectural=/^(?:(\d+)\s+)?(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+))?\s*"\s*=\s*(?:(\d+(?:\.\d+)?)\s*'\s*(?:-?\s*(\d+(?:\.\d+)?)\s*")?|(\d+(?:\.\d+)?)\s*")$/;
const engineering=/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/;
const caption=/\b(?:floor plan|ceiling plan|site plan|demo(?:lition)? plan|roof plan|foundation plan)\b/i;
const uncertain=/^(?:n\.?\s*t\.?\s*s\.?|not to scale|as indicated|varies)$/i;
const normalize=(text:string)=>text.trim().replace(/[“”″]/g,'"').replace(/[‘’′]/g,"'").replace(/[–−]/g,'-');

export function printedScale(labels:Label[],width:number,height:number):Calibration|undefined {
  let result:Calibration|undefined;
  for(const label of labels){
    const text=normalize(label.text);
    const prefix=/^scale(?:\s*:\s*|\s+)/i.exec(text);
    const value=text.slice(prefix?.[0].length??0);
    if(uncertain.test(value))return;
    const imperial=architectural.exec(value);
    const ratio=engineering.exec(value);
    if(!imperial&&!ratio){
      if(prefix&&/^(?:\d|\.\d).*(?:=|:)/.test(value))return;
      continue;
    }
    if(!prefix&&!labels.some(other=>other!==label&&other.text.length<100&&caption.test(other.text)&&
      Math.abs(other.bounds[0]-label.bounds[0])<=115&&Math.abs(other.bounds[1]-label.bounds[1])<=40)){
      // An unlabeled ratio could be a note or slope. A numeric architectural
      // caption outside the plan title could also belong to a detail.
      if(imperial)return;
      continue;
    }
    const points=imperial?72*(Number(imperial[1]??0)+Number(imperial[2])/Number(imperial[3]??1)):72;
    const feet=imperial?Number(imperial[4]??0)+Number(imperial[5]??imperial[6]??0)/12:Number(ratio![2])/Number(ratio![1])/12;
    if(!Number.isFinite(points)||!Number.isFinite(feet)||points<=0||points>width||feet<=0||height<=0)return;
    if(result){
      const previous=result.feet/result.points[1][0];
      if(Math.abs(previous-feet/points)>previous*1e-9)return;
    }else result={points:[[0,0],[points,0]],feet,source:`Printed scale: ${text}`};
  }
  return result;
}
