import type { Point } from './domain';

type Stroke={paint:string;color:string;points:Point[];simple:boolean;width:number};
type Bounds=[number,number,number,number];

export function dashedPartitions(paths:Stroke[], legend:Bounds){
  const lines=paths.flatMap(p=>{
    if(p.paint!=='stroke'||!p.simple||p.points.length<2||!p.color)return [];
    return p.points.slice(1).flatMap((b,index)=>{
      const a=p.points[index];
      const vertical=Math.abs(a[0]-b[0])<.12;
      const axis=vertical?1:0, cross=1-axis;
      const lo=Math.min(a[axis],b[axis]),hi=Math.max(a[axis],b[axis]);
      if(hi-lo<3||Math.abs(a[cross]-b[cross])>=.12)return [];
      return [{vertical,lo,hi,at:(a[cross]+b[cross])/2,style:p.color+'/'+p.width}];
    });
  });
  const swatch=lines.filter(l=>!l.vertical&&l.hi<legend[0]&&l.lo>legend[0]-130&&
    l.at>=legend[1]-8&&l.at<=legend[3]+8);
  const pairs=swatch.flatMap(a=>swatch.filter(b=>Math.abs(a.at-b.at)<.12&&b.lo>a.hi&&
    b.lo-a.hi<24&&b.style===a.style).map(b=>({a,b,gap:b.lo-a.hi})));
  const sample=pairs.find(({a,b,gap})=>pairs.some(p=>Math.abs(p.a.at-a.at)>2&&
    Math.abs(p.gap-gap)<.2&&Math.abs(p.a.lo-a.lo)<.2&&Math.abs(p.b.lo-b.lo)<.2));
  if(!sample)return [];
  const separation=Math.min(...pairs.filter(p=>Math.abs(p.a.at-sample.a.at)>2&&
    Math.abs(p.gap-sample.gap)<.2&&Math.abs(p.a.lo-sample.a.lo)<.2).map(p=>Math.abs(p.a.at-sample.a.at)));
  if(!Number.isFinite(separation)||separation>25)return [];
  const edges=lines.filter(l=>l.style===sample.a.style&&l.hi-l.lo<=Math.max(sample.a.hi-sample.a.lo,sample.b.hi-sample.b.lo)*1.2&&
    (l.vertical?l.at<legend[0]-130:l.hi<legend[0]-130));
  const groups=new Map<string,typeof edges>();
  for(const line of edges){
    const key=line.vertical+'/'+Math.round(line.at*10);
    const group=groups.get(key)??[];group.push(line);groups.set(key,group);
  }
  const runs:typeof edges=[];
  for(const group of groups.values()){
    group.sort((a,b)=>a.lo-b.lo);
    let first=group[0],last=first,count=1;
    const finish=()=>{if(count>=2)runs.push({...first,hi:last.hi});};
    for(const line of group.slice(1)){
      if(Math.abs(line.lo-last.hi-sample.gap)<.35){last=line;count++;}
      else{finish();first=last=line;count=1;}
    }
    finish();
  }
  const output:[Point,Point][]=[];
  for(const a of runs)for(const b of runs){
    if(a.vertical!==b.vertical||Math.abs(b.at-a.at-separation)>1.1)continue;
    const lo=Math.max(a.lo,b.lo),hi=Math.min(a.hi,b.hi);
    if(hi-lo<27||hi-lo<.5*Math.min(a.hi-a.lo,b.hi-b.lo))continue;
    const mid=(a.at+b.at)/2;
    output.push(a.vertical?[[mid,lo],[mid,hi]]:[[lo,mid],[hi,mid]]);
  }
  return output;
}
