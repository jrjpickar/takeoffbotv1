import { distance, type Item, type Point } from './domain';

type Bounds = [number, number, number, number];
type Path = {
  seq: number; width: number; paint: string; color: string;
  bounds: Bounds; simple: boolean; points: Point[];
};
type Label = {text: string; bounds: Bounds};
type Scope = 'wall' | 'door' | 'fixture' | 'millwork' | 'blind';
type Candidate = {scope: Scope; tool: Item['tool']; points: Point[]; source: string; key: string};
const center = ([l,t,r,b]:Bounds):Point => [(l+r)/2,(t+b)/2];
const near = ([x,y]:Point,[l,t,r,b]:Bounds,pad:number) =>
  x>=l-pad && x<=r+pad && y>=t-pad && y<=b+pad;
const span = (b:Bounds) => [b[2]-b[0], b[3]-b[1]].sort((a,b)=>a-b);
const axis = (a:Point,b:Point) => Math.abs(a[0]-b[0])<.08 || Math.abs(a[1]-b[1])<.08;

function circle(a:Point,b:Point,c:Point):Point|undefined {
  const [x,y]=[b[0]-a[0],b[1]-a[1]], [u,v]=[c[0]-a[0],c[1]-a[1]];
  const det=2*(x*v-y*u);
  if(Math.abs(det)<1)return;
  return [a[0]+(v*(x*x+y*y)-y*(u*u+v*v))/det,
    a[1]+(x*(u*u+v*v)-u*(x*x+y*y))/det];
}

// CAD plots a dashed swing as consecutive tessellated paths. Check tangent
// continuity at the gap and fit the combined swing, since fitting short dashes
// individually amplifies coordinate rounding.
function dot(a:Point,b:Point,c:Point,d:Point) {
  return ((b[0]-a[0])*(d[0]-c[0])+(b[1]-a[1])*(d[1]-c[1])) /
    (distance(a,b)*distance(c,d));
}
function swings(paths:Path[], color:string, width:number, maxGap:number) {
  const chains:Path[][]=[];
  for(const p of paths){
    const pts=p.points;
    if(p.color!==color||p.width!==width||pts.length<3||pts.length>25||distance(pts[0],pts.at(-1)!)<2)continue;
    const chain=chains.at(-1), previous=chain?.at(-1);
    if(previous&&previous.seq+1===p.seq){
      const end=previous.points.at(-1)!, before=previous.points.at(-2)!;
      const gap=distance(end,pts[0]);
      if(gap>maxGap*.4&&gap<maxGap*1.12&&
        dot(before,end,end,pts[0])>.95&&dot(pts[0],pts[1],end,pts[0])>.95){
        chain!.push(p);
        continue;
      }
    }
    chains.push([p]);
  }
  return chains.flatMap(chain=>{
    if(chain.length<2)return [];
    const pts=chain.flatMap(p=>p.points), first=pts[0], last=pts.at(-1)!;
    const hinge=circle(first,pts[Math.floor(pts.length/2)],last);
    if(!hinge)return [];
    const radius=distance(first,hinge), chord=distance(first,last)/radius;
    if(chord<.7||chord>1.98||pts.some(pt=>Math.abs(distance(pt,hinge)-radius)>.6))return [];
    return [{hinge,radius,chord,points:pts,key:chain[0].seq}];
  });
}

function footprints(paths:Path[], color:string, maxWidth:number, gap:number) {
  const result:{points:Point[]; key:number}[]=[];
  let points:Point[]=[], key=0, prev=-2;
  for(const p of paths){
    const part=p.points;
    if(p.color!==color||p.width<=0||p.width>maxWidth||part.length>6||
      part.slice(1).some((b,i)=>!axis(part[i],b)))continue;
    const last=points.at(-1);
    if(!last||p.seq!==prev+1||!axis(last,part[0])||distance(last,part[0])>gap+.16){
      points=[];
      key=p.seq;
    }
    prev=p.seq;
    for(const pt of part){
      if(points.length&&distance(pt,points.at(-1)!)<.08)continue;
      const a=points.at(-2), b=points.at(-1);
      if(a&&b&&([0,1] as const).some(i=>Math.abs(a[i]-b[i])<.08&&Math.abs(b[i]-pt[i])<.08))points.pop();
      points.push(pt);
    }
    if(points.length>=4&&distance(points[0],points.at(-1)!)<.12){
      result.push({points:points.slice(0,-1),key});
      points=[];
    }
  }
  return result;
}

export function keyedDemolition(all:Path[], labels:Label[], pointsPerFoot:number) {
  const candidates:Candidate[]=[], warnings:string[]=[];
  const add=(scope:Scope,tool:Item['tool'],points:Point[],key:number,source:string)=>{
    if(tool==='count'&&candidates.some(c=>c.scope===scope&&distance(c.points[0],points[0])<3))return;
    candidates.push({scope,tool,points,key:`keyed-${scope}-${key}`,source});
  };
  const heading=labels.find(l=>/^DEMO(?:LITION)? LEGEND$/i.test(l.text));
  if(!heading||!labels.some(l=>/^DEMOLITION FLOOR PLAN$/i.test(l.text)))return {candidates,warnings};
  const legend=(pattern:RegExp)=>labels.find(l=>pattern.test(l.text)&&
    l.bounds[1]>heading.bounds[3]&&l.bounds[1]-heading.bounds[3]<250&&
    Math.abs(l.bounds[0]-heading.bounds[0])<180);
  const removed=legend(/^EXISTING DOOR TO BE REMOVED\.?$/i);
  const retained=legend(/^EXISTING DOOR TO REMAIN\.?$/i);
  if(!removed||!retained||!legend(/^EXISTING CONSTRUCTION TO BE REMOVED\.?$/i))return {candidates,warnings};
  const paths=all.filter(p=>p.paint==='stroke'&&p.simple&&p.points.length>1);
  const onPlan=paths.filter(p=>p.bounds[2]<heading.bounds[0]-30);
  const swatch=paths.filter(p=>p.bounds[0]>removed.bounds[0]-130&&p.bounds[2]<removed.bounds[0]&&
    p.bounds[1]>removed.bounds[1]-16&&p.bounds[3]<removed.bounds[3]+16&&p.points.length>=6);
  const bySequence=new Map(all.filter(p=>p.paint==='stroke').map(p=>[p.seq,p]));
  const sample=swatch[0];
  if(sample&&swatch.length===2&&sample.color===swatch[1].color&&sample.width===swatch[1].width){
    const gap=distance(sample.points.at(-1)!,swatch[1].points[0]);
    const symbol=swings(swatch,sample.color,sample.width,gap)[0];
    if(symbol){
      const vault=leaders(/^EXISTING (?:STAINLESS STEEL )?VAULT$/i, /\bDOOR FRAME TO BE REMOVED\b/i);
      for(const mark of swings(onPlan,sample.color,sample.width,gap)){
        const frame=mark.chord>1.48&&vault.some(n=>mark.points.some(pt=>distance(pt,n.tip)<2.5*pointsPerFoot));
        if((mark.chord<=1.48||frame)&&mark.radius>=pointsPerFoot&&mark.radius<=5.5*pointsPerFoot)
          add('door','count',[mark.hinge],mark.key,'Dashed swing matches door removal legend');
      }
      warnings.push('Doors: check vault frame and nonstandard openings against keyed notes; solid storefront swings stay.');
    }
  }
  // A leader terminates beside the first text line. The short landing and
  // diagonal shaft are required so nearby dimension lines cannot seed a scope.
  function leaders(pattern:RegExp, continuation:RegExp) {
    return labels.filter(l=>pattern.test(l.text)).flatMap(label=>{
      const [left,top,right,bottom]=label.bounds;
      const following=labels.filter(l=>l.bounds[1]>top&&l.bounds[1]-top<5*(bottom-top)&&
        Math.abs(l.bounds[0]-left)<2).sort((a,b)=>a.bounds[1]-b.bounds[1]);
      let last=top, text=label.text;
      for(const line of following){
        if(line.bounds[1]-last>1.65*(bottom-top))break;
        text+=' '+line.text;
        last=line.bounds[1];
      }
      if(!continuation.test(text))return [];
      return onPlan.flatMap(p=>{
        if(p.points.length!==3)return [];
        const [tip,bend,end]=p.points;
        if(Math.abs(end[1]-bend[1])>.08||distance(bend,end)<5||distance(tip,bend)<10||
          axis(tip,bend)||end[1]<top||end[1]>bottom||Math.min(Math.abs(end[0]-left),Math.abs(end[0]-right))>4)return [];
        // The plotted triangular arrowhead meets the first shaft segment.
        const arrow=bySequence.get(p.seq-1);
        const target=arrow&&arrow.width===0&&arrow.points.length===3&&near(tip,arrow.bounds,1)?arrow.points.reduce((furthest,pt)=>distance(pt,bend)>distance(furthest,bend)?pt:furthest):undefined;
        return [{tip:target??tip, key:p.seq}];
      });
    });
  }
  const blindNotes=leaders(/^EXISTING WINDOW BLINDS\b/i,/\bTO BE REMOVED\b/i);
  for(const note of blindNotes){
    const options=onPlan.filter(p=>{
      const [short,long]=span(p.bounds);
      return p.points.length===5&&distance(p.points[0],p.points[4])<.1&&
        p.points.slice(1).every((pt,i)=>axis(p.points[i],pt))&&
        short>=3&&short<=pointsPerFoot&&long>=3*pointsPerFoot&&near(note.tip,p.bounds,1);
    }).sort((a,b)=>span(b.bounds)[1]-span(a.bounds)[1]);
    const glazing=options[0];
    if(!glazing){warnings.push('Blinds: a removal leader could not be tied to a glazing run.');continue;}
    if(options[1]&&span(options[1].bounds)[1]>span(glazing.bounds)[1]*.95&&
      distance(center(options[1].bounds),center(glazing.bounds))>2){
      warnings.push('Blinds: a leader touches competing glazing runs.');continue;
    }
    const [l,t,r,b]=glazing.bounds;
    const horizontal=r-l>b-t;
    const fixed=horizontal?Math.abs(note.tip[1]-t)<Math.abs(note.tip[1]-b)?t:b:
      Math.abs(note.tip[0]-l)<Math.abs(note.tip[0]-r)?l:r;
    add('blind','line',horizontal?[[l,fixed],[r,fixed]]:[[fixed,t],[fixed,b]],glazing.seq,
      'Glazing edge indicated by window blind removal leader');
  }

  if(blindNotes.length>1)warnings.push('Blinds: verify the extents of each separately keyed glazing run.');

  const millworkNotes=leaders(/^EXISTING PREVIOUS TENANT FIXTURES\b/i,/\bMILLWORK TO BE REMOVED\b/i);
  if(millworkNotes.length&&sample){
    for(const footprint of footprints(onPlan,sample.color,sample.width,pointsPerFoot/4)){
      // Select only a closed perimeter touched by a removal leader. Unkeyed
      // dashed boxes could be furniture, equipment or floor devices.
      if(!millworkNotes.some(({tip})=>footprint.points.some((a,i)=>{
        const b=footprint.points[(i+1)%footprint.points.length];
        return near(tip,[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])],2);
      })))continue;
      add('millwork','polygon',footprint.points,footprint.key,'Closed dashed perimeter at millwork removal leader');
    }
    warnings.push('Millwork: the typical removal note may apply to other casework; check unkeyed footprints and shared outlines.');
  }

  const restroom=leaders(/^EXISTING FINISHES, WATER CLOSET,?$/i,/\bLAVATORY\b.*\bTO BE REMOVED\b/i);
  if(restroom.length){
    const fixtures=onPlan.filter(p=>sample&&p.width===sample.width&&p.color===sample.color&&
      p.points.length>=28);
    for(const p of fixtures){
      const [short,long]=span(p.bounds), at=center(p.bounds);
      if(!restroom.some(n=>Math.abs(n.tip[0]-at[0])<4.5*pointsPerFoot&&
        Math.abs(n.tip[1]-at[1])<8*pointsPerFoot&&at[1]<=n.tip[1]+pointsPerFoot))continue;
      const opening=distance(p.points[0],p.points.at(-1)!);
      const bowl=opening<pointsPerFoot*.28&&short>.8*pointsPerFoot&&long>1.15*pointsPerFoot&&
        long<1.5*pointsPerFoot&&long/short>1.25;
      const drain=opening<.15&&short>.18*pointsPerFoot&&long<.24*pointsPerFoot&&long/short<1.15&&
        fixtures.some(q=>span(q.bounds)[1]<short*.75&&distance(at,center(q.bounds))<.15);
      if(bowl||drain)add('fixture','count',[at],p.seq,'Bowl or lavatory drain within restroom removal callout');
    }
  }
  for(const note of leaders(/^EXISTING SINK\b/i,/\bPLUMBING LINES TO BE REMOVED\b/i)){
    // Match two facing rounded ends of the sink symbol close to the leader.
    const ends=onPlan.filter(p=>{
      const [short,long]=span(p.bounds);
      return p.width===sample?.width&&p.points.length>=12&&short>2&&short<6&&
        long>pointsPerFoot*.7&&long<pointsPerFoot*1.3&&near(note.tip,p.bounds,pointsPerFoot*1.5);
    });
    const pairs=ends.flatMap((a,i)=>ends.slice(i+1).flatMap(b=>{
      const u=center(a.bounds),v=center(b.bounds);
      if(Math.abs(u[1]-v[1])>.6||Math.abs(u[0]-v[0])<pointsPerFoot*.65||
        Math.abs(u[0]-v[0])>pointsPerFoot*1.4||Math.abs(span(a.bounds)[1]-span(b.bounds)[1])>.5)return [];
      return [[(u[0]+v[0])/2,(u[1]+v[1])/2] as Point];
    }));
    if(pairs.length===1)add('fixture','count',pairs,note.key,'Sink symbol indicated by plumbing removal leader');
  }
  if(restroom.length)warnings.push('Plumbing fixtures: verify the restroom symbols and sink count. The utility sink called to remain is excluded.');

  for(const note of leaders(/^REMOVE PORTION OF EXISTING INTERIOR\b/i,/\bPARTITION LEAVING HEADER\b/i)){
    const cap=onPlan.find(p=>p.points.length===3&&p.points.slice(1).every((pt,i)=>axis(p.points[i],pt))&&
      span(p.bounds)[0]>=4&&span(p.bounds)[1]<pointsPerFoot&&p.bounds[2]<note.tip[0]&&
      note.tip[0]-p.bounds[2]<3*pointsPerFoot&&near(note.tip,p.bounds,3*pointsPerFoot)&&
      note.tip[1]>=p.bounds[1]-1&&note.tip[1]<=p.bounds[3]+1);
    if(!cap)continue;
    const [l,t,,b]=cap.bounds;
    const other=onPlan.find(p=>p.width===cap.width&&p.points.length===4&&p.bounds[0]>l&&
      p.bounds[2]-l<5*pointsPerFoot&&Math.abs(p.bounds[1]-t)<.12&&Math.abs(p.bounds[3]-b)<.12&&
      p.points.slice(1).every((pt,i)=>axis(p.points[i],pt))&&p.bounds[0]<=note.tip[0]+pointsPerFoot);
    if(!other||candidates.some(c=>c.key===`keyed-wall-${cap.seq}`))continue;
    const middleDash=(y:number)=>onPlan.some(p=>p.width===cap.width&&p.points.length===2&&
      Math.abs(p.bounds[1]-y)<.12&&Math.abs(p.bounds[3]-y)<.12&&
      p.bounds[0]>cap.bounds[2]&&p.bounds[2]<other.bounds[0]);
    if(middleDash(t)&&middleDash(b)){
      const mid=(t+b)/2;
      add('wall','line',[[l,mid],[other.bounds[2],mid]],cap.seq,'Capped dashed partition indicated by header-removal note');
    }
  }
  return {candidates,warnings};
}
