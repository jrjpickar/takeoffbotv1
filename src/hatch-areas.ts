import clipping from 'polygon-clipping';
import type { Point } from './domain';

export type HatchStroke={seq:number;paint:string;color:string;points:Point[];simple:boolean};
const root=Math.SQRT2;
const precision=(n:number)=>Math.round(n*100)/100;

export function hatchAreas(paths:HatchStroke[], label:[number,number,number,number]) {
  const strokes=paths.flatMap(path=>{
    if(path.paint!=='stroke'||!path.simple||path.points.length!==2||!path.color)return [];
    const [a,b]=path.points, dx=b[0]-a[0],dy=b[1]-a[1];
    if(Math.abs(dx)<1||Math.abs(Math.abs(dx)-Math.abs(dy))>.03)return [];
    const slope=Math.sign(dx*dy);
    const v=(p:Point)=>(p[1]-slope*p[0])/root;
    const u=(p:Point)=>(p[0]+slope*p[1])/root;
    const offset=(v(a)+v(b))/2;
    return [{path,slope,offset,lo:Math.min(u(a),u(b)),hi:Math.max(u(a),u(b))}];
  });
  const swatches=strokes.filter(({path})=>path.points.every(([x,y])=>
    x<label[0]&&x>=label[0]-105&&y>=label[1]-16&&y<=label[3]+16));
  const styles=new Set(swatches.map(s=>s.path.color+'/'+s.slope));
  if(styles.size!==1||swatches.length<5)return null;
  const style=styles.values().next().value;
  const rows=swatches.map(s=>s.offset).sort((a,b)=>a-b);
  const gaps=rows.slice(1).map((v,i)=>v-rows[i]).filter(v=>v>.2).sort((a,b)=>a-b);
  const step=gaps[Math.floor(gaps.length/2)];
  if(!(step>=.5&&step<=12)||gaps.filter(gap=>Math.abs(gap-step)<.08).length<4)return null;
  const swatchIds=new Set(swatches.map(s=>s.path.seq));
  const lines=strokes.filter(s=>!swatchIds.has(s.path.seq)&&s.path.color+'/'+s.slope===style);
  if(lines.length<8||lines.length>5000)return null;
  // Keep independent hatch phases separate. Nearby strips meet at identical rounded row edges.
  const phases:{offset:number; strips:clipping.Polygon[]}[]=[];
  for(const line of lines){
    let phase=phases.find(p=>Math.abs(line.offset-p.offset-Math.round((line.offset-p.offset)/step)*step)<.07);
    if(!phase){phase={offset:line.offset,strips:[]};phases.push(phase);}
    const row=Math.round((line.offset-phase.offset)/step);
    const top=precision(phase.offset+(row-.5)*step),bottom=precision(phase.offset+(row+.5)*step);
    const left=precision(line.lo),right=precision(line.hi);
    if(right>left)phase.strips.push([[[left,top],[right,top],[right,bottom],[left,bottom],[left,top]]]);
  }
  const slope=swatches[0].slope;
  const candidates:Point[][]=[];
  let unsupported=0;
  for(const phase of phases){
    if(phase.strips.length<8)continue;
    const [first,...rest]=phase.strips;
    for(const poly of clipping.union(first,...rest)){
      const outline=poly[0];
      const area=Math.abs(outline.slice(1).reduce((a,p,i)=>a+outline[i][0]*p[1]-p[0]*outline[i][1],0))/2;
      if(area<step*step*12)continue;
      if(poly.length!==1||outline.length>1200){unsupported++;continue;}
      candidates.push(outline.slice(0,-1).map(([u,v])=>[(u-slope*v)/root,(slope*u+v)/root]));
    }
  }
  return {candidates,unsupported};
}
