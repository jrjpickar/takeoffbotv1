import type {Point} from './domain';

export const cadLayer=(name:string)=>name.split('|').at(-1)?.toUpperCase()??'';

export function cadDemoTitle(layers:string[]){
  const names=layers.map(cadLayer);
  const floor=names.includes('A-DEMO-FLOR')&&names.includes('A-DEMO-FLOR-NOTE');
  const ceiling=names.includes('A-DEMO-CLNG')&&names.includes('A-DEMO-CLNG-NOTE');
  if(floor!==ceiling)return floor?'Demolition Floor Plan':'Demolition Ceiling Plan';
}

export function cadWallRuns(paths:{layer?:string;paint:string;simple:boolean;points:Point[]}[]){
  // This CAD export draws the wall edges as individual dash segments.
  const groups=new Map<string,{vertical:boolean;at:number;segments:[number,number][]}>();
  for(const path of paths){
    if(path.layer!=='A-DEMO'||path.paint!=='stroke'||!path.simple)continue;
    for(let i=1;i<path.points.length;i++){
      const a=path.points[i-1],b=path.points[i];
      const vertical=Math.abs(a[0]-b[0])<.1;
      const axis=vertical?1:0,cross=1-axis;
      const length=Math.abs(a[axis]-b[axis]);
      if(Math.abs(a[cross]-b[cross])>=.1||length<3||length>18.2)continue;
      const at=(a[cross]+b[cross])/2;
      const key=vertical+'/'+Math.round(at*10);
      const group=groups.get(key)??{vertical,at,segments:[]};
      group.segments.push([Math.min(a[axis],b[axis]),Math.max(a[axis],b[axis])]);
      groups.set(key,group);
    }
  }
  const runs:{vertical:boolean;at:number;lo:number;hi:number}[]=[];
  for(const {vertical,at,segments} of groups.values()){
    segments.sort((a,b)=>a[0]-b[0]);
    let [lo,hi]=segments[0],count=1;
    for(const [start,end] of segments.slice(1)){
      if(end<=hi+.1)continue;
      if(Math.abs(start-hi-9)<.35){hi=end;count++;continue;}
      if(count>=2)runs.push({vertical,at,lo,hi});
      lo=start;hi=end;count=1;
    }
    if(count>=2)runs.push({vertical,at,lo,hi});
  }
  const pairs=runs.flatMap((a,i)=>runs.slice(i+1).flatMap(b=>{
    const gap=Math.abs(b.at-a.at), lo=Math.max(a.lo,b.lo),hi=Math.min(a.hi,b.hi);
    if(b.vertical!==a.vertical||gap<5.8||gap>8.2||hi-lo<36||
      hi-lo<.65*Math.min(a.hi-a.lo,b.hi-b.lo))return [];
    return [{a,b,lo,hi}];
  })).sort((a,b)=>(b.hi-b.lo)-(a.hi-a.lo));
  const output:[Point,Point][]=[];
  const used=new Set<typeof runs[number]>();
  for(const {a,b,lo,hi} of pairs){
    if(used.has(a)||used.has(b))continue;
    const mid=(a.at+b.at)/2;
    // A multi-line wall can supply a second pair from its inner edges.
    if(output.some(([start,end])=>{
      const axis=a.vertical?1:0,cross=1-axis;
      return start[cross]===end[cross]&&Math.abs(start[cross]-mid)<13&&
        Math.min(hi,end[axis])-Math.max(lo,start[axis])>=.8*(hi-lo);
    }))continue;
    used.add(a);used.add(b);
    output.push(a.vertical?[[mid,lo],[mid,hi]]:[[lo,mid],[hi,mid]]);
  }
  return output;
}
