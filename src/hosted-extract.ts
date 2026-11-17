import { VectorPoints } from './vector-points';
import { keyedDemolition } from './keyed-demolition';
import { cadDemoTitle, cadLayer, cadWallRuns } from './cad-demolition';
import { dashedPartitions } from './dashed-partitions';
import { decodeSheetLabel, sheetIdentity } from './sheet-labels';
import { printedScale } from './sheet-scale';
import * as pdf from 'mupdf';
import { hatchAreas } from './hatch-areas';
import { demolitionLegend } from './legend-scope';
import { wallPairs } from './raster-walls';
import { distance, factor, measure, scopes, type Calibration, type Item, type Point, type Rule, type Scope, type Sheet } from './domain';

class Stroke {
  constructor(readonly layer:string|undefined,readonly seq:number,readonly paint:'stroke'|'fill',
    readonly width:number,readonly color:string,readonly dashed:boolean,readonly bounds:pdf.Rect,
    readonly closed:boolean,readonly simple:boolean,private coordinates:VectorPoints,
    private start:number,readonly pointCount:number){}
  get points(){return this.coordinates.read(this.start,this.pointCount);}
}
const tag=/^A2Z TAKEOFF:\s*(\w+)(?:\s+THICKNESS=(\d+(?:\.\d+)?)IN)?$/i;
const legend=/^A2Z LEGEND:\s*(\w+)(?:\s+THICKNESS=(\d+(?:\.\d+)?)IN)?$/i;
const bar=/^A2Z SCALE BAR:\s*(\d+(?:\.\d+)?)\s*FT$/i;
const scopeOf=(key:string)=>Object.hasOwn(scopes,key.toLowerCase()) ? key.toLowerCase() as Scope : undefined;
const byte=(n:number)=>Math.round(Math.max(0,Math.min(1,n))*255);
const hex=Array.from({length:256},(_,n)=>n.toString(16).padStart(2,'0'));
function strokeColor(cs:pdf.ColorSpace,color:number[]){
  if(cs.isRGB())return '#'+hex[byte(color[0])]+hex[byte(color[1])]+hex[byte(color[2])];
  if(cs.isGray()){const gray=hex[byte(color[0])];return '#'+gray+gray+gray;}
  return '';
}
type SnapPath={color:string|null;dashed:boolean;items:[string,Point[]][]};

let current:{id:string; doc:pdf.Document; stream?:pdf.Stream}|undefined;
async function document(id:string, file:Blob) {
  if(current?.id===id) return current.doc;
  let stream:pdf.Stream|undefined;
  let doc:pdf.Document;
  if(typeof FileReaderSync!=='undefined'){
    const reader=new FileReaderSync();
    const chunkSize=256*1024;
    const blocks=new Map<number,Uint8Array>();
    stream=new pdf.Stream({
      fileSize:()=>file.size,
      read(memory,offset,length,position){
        let written=0;
        while(written<length&&position+written<file.size){
          const cursor=position+written;
          const base=Math.floor(cursor/chunkSize)*chunkSize;
          let block=blocks.get(base);
          if(!block){
            block=new Uint8Array(reader.readAsArrayBuffer(file.slice(base,base+chunkSize)));
            if(blocks.size>=32)blocks.delete(blocks.keys().next().value!);
            blocks.set(base,block);
          }
          const start=cursor-base, count=Math.min(length-written,block.length-start);
          if(count<=0)break;
          memory.set(block.subarray(start,start+count),offset+written);
          written+=count;
        }
        return written;
      },
      close(){blocks.clear();},
    });
    try{doc=pdf.Document.openDocument(stream,'application/pdf');}
    catch(error){stream.destroy();throw error;}
  }else doc=pdf.Document.openDocument(await file.arrayBuffer(),'application/pdf');
  current?.doc.destroy();
  current?.stream?.destroy();
  sheetCache.clear();
  activeSheet=undefined;
  previewMetadata=undefined;
  pdf.emptyStore();
  rasterCache.clear();
  current={id,doc,stream};
  return doc;
}
function demoTitle(page:pdf.Page){
  if(!(page instanceof pdf.PDFPage))return;
  const object=page.getObject();
  const resources=object.getInheritable('Resources');
  const properties=resources.get('Properties');
  const layers:string[]=[];
  try{
    if(properties.isDictionary())properties.forEach(entry=>{
      const name=entry.get('Name');
      try{if(name.isString())layers.push(name.asString());}finally{name.destroy();entry.destroy();}
    });
    return cadDemoTitle(layers);
  }finally{properties.destroy();resources.destroy();object.destroy();}
}
function sheetInfo(page:pdf.Page,index:number):Sheet {
  const [x0,y0,x1,y1]=page.getBounds('CropBox');
  const rawLabel=decodeSheetLabel(page.getLabel()).replace(/^\[\d+\]\s+(?=[A-Z])/i,'');
  const label=/^[A-Z]+\d+[\w.-]*_.*-([A-Z]{1,5}\d+\.\d+[A-Z]?)$/i.exec(rawLabel)?.[1]??rawLabel;
  const demo=demoTitle(page);
  if(demo)return {name:`${label} ${demo}`,planName:`${label} ${demo}`,keywords:['Demolition',demo],width:x1-x0,height:y1-y0};
  let identity=sheetIdentity(label,[]);
  if(!identity.title){
    const text=page.toStructuredText('');
    try{identity=sheetIdentity(label,text.asText().split('\n'));}finally{text.destroy();}
  }
  return {name:identity.title ? `Sheet ${index+1} (${identity.title})` : `Sheet ${index+1}`,keywords:identity.keywords,
    width:x1-x0,height:y1-y0,planName:/^[A-Z]{1,3}[-.]?\d{1,3}(?:\.\d+)?[A-Z]?\b/.test(label)?`${label} - Sheet ${index+1}`:undefined};
}
export async function sheets(id:string,file:Blob) {
  const doc=await document(id,file);
  const count=doc.countPages();
  if(doc.needsPassword() || count<1 || count>300) throw new Error('Use an unlocked, readable PDF with 1–300 sheets.');
  return Array.from({length:count},(_,i)=>{
    const page=doc.loadPage(i);
    try{return sheetInfo(page,i);}finally{page.destroy();}
  });
}
const rasterCache=new Map<number,[Point,Point][]>();
// Approximate retained JS memory: include both the path record and its
// vertices. Oversized sheets remain fully usable but are not cached.
const sheetBudget=16*1024*1024;
const sheetCache=new Map<number,ReturnType<typeof extractSheet>>();
let activeSheet:number|undefined;
let previewMetadata:ReturnType<typeof sheetMetadata>|undefined;
function selectSheet(index:number){
  if(activeSheet===index)return;
  if(activeSheet!==undefined){
    const previous=sheetCache.get(activeSheet);
    if(previous&&previous.cost>sheetBudget/4)sheetCache.delete(activeSheet);
    pdf.emptyStore();
  }
  activeSheet=index;
  previewMetadata=undefined;
}
function extract(doc:pdf.Document,index:number) {
  const cached=sheetCache.get(index);
  if(cached){
    sheetCache.delete(index);
    sheetCache.set(index,cached);
    return cached;
  }
  // Release old geometry before starting another potentially dense sheet.
  // Only small sheets remain eligible for reuse across sheet changes.
  for(const [key,value] of sheetCache)if(value.cost>sheetBudget/4)sheetCache.delete(key);
  const result=extractSheet(doc,index);
  if(result.cost>sheetBudget/4)sheetCache.clear();
  if(result.cost<=sheetBudget){
    let cost=result.cost;
    for(const value of sheetCache.values())cost+=value.cost;
    while(sheetCache.size>=3||cost>sheetBudget){
      const key=sheetCache.keys().next().value!;
      cost-=sheetCache.get(key)!.cost;
      sheetCache.delete(key);
    }
    sheetCache.set(index,result);
  }
  return result;
}

const coordinate=(value:number)=>Math.round(value*1e4)/1e4;
function pageGeometry(page:pdf.Page){
  const [x0,y0,x1,y1]=page.getBounds('CropBox');
  const point=(x:number,y:number,m:pdf.Matrix):Point=>[
    coordinate(m[0]*x+m[2]*y+m[4]-x0),
    coordinate(m[1]*x+m[3]*y+m[5]-y0),
  ];
  return {x0,y0,x1,y1,point};
}

function walkContents(page:pdf.Page, callbacks:Partial<Pick<pdf.Device,'strokePath'|'fillPath'|'beginLayer'|'endLayer'>>){
  const device=new pdf.Device(callbacks);
  try {
    page.runPageContents(device,pdf.Matrix.identity);
    device.close();
  } finally {device.destroy();}
}

function extractSheet(doc:pdf.Document,index:number) {
  const page=doc.loadPage(index);
  try{
    const geometry=pageGeometry(page);
    const paths:Stroke[]=[];
    const coordinates=new VectorPoints();
    let strokeId=0,fillId=0;
    const layers:string[]=[];
    const demo=demoTitle(page);
    function readPath(path:pdf.Path,m:pdf.Matrix,color:string,paint:Stroke['paint'],dashed:boolean,width=0){
      let moves=0,closed=false,curved=false;
      // Measurement heuristics consume endpoints only and reject curves and
      // disconnected paths as simple shapes. The snap walk reads commands
      // directly from the PDF, including cubic control points.
      const start=coordinates.length;
      const bounds:pdf.Rect=[Infinity,Infinity,-Infinity,-Infinity];
      const add=(x:number,y:number)=>{
        const u=coordinate(m[0]*x+m[2]*y+m[4]-geometry.x0);
        const v=coordinate(m[1]*x+m[3]*y+m[5]-geometry.y0);
        coordinates.push(u,v);
        bounds[0]=Math.min(bounds[0],u);bounds[1]=Math.min(bounds[1],v);
        bounds[2]=Math.max(bounds[2],u);bounds[3]=Math.max(bounds[3],v);
      };
      path.walk({
        moveTo(x,y){add(x,y);moves++;},
        lineTo:add,
        curveTo(_a,_b,_c,_d,x,y){add(x,y);curved=true;},
        closePath(){closed=true;},
      });
      const count=coordinates.length-start;
      if(count)paths.push(new Stroke(layers.at(-1),paint==='stroke'?strokeId++:--fillId,paint,Math.round(width*100)/100,
        color,dashed,bounds,closed,moves===1&&!curved,coordinates,start,count));
    }
    walkContents(page,{
      beginLayer(name){layers.push(cadLayer(name));},
      endLayer(){layers.pop();},
      strokePath(path,stroke,m,cs,color,alpha){
        try{if(alpha>0)readPath(path,m,strokeColor(cs,color),'stroke',!!stroke.getDashes()?.length,stroke.getLineWidth()*Math.hypot(m[0],m[1]));}
        finally{path.destroy();stroke.destroy();cs.destroy();}
      },
      fillPath(path,_,m,cs,color,alpha){
        // Achromatic fills are excluded from finish swatches, as before.
        try{if(alpha>0&&cs.isRGB()&&Math.max(...color)-Math.min(...color)>=.04)readPath(path,m,strokeColor(cs,color),'fill',false);}
        finally{path.destroy();cs.destroy();}
      },
    });
    const metadata=previewMetadata??sheetMetadata(page,geometry);
    let cost=coordinates.bytes+224*paths.length;
    for(const label of metadata.labels)cost+=128+2*label.text.length;
    for(const a of metadata.annotations)cost+=128+2*a.text.length+64*a.points.length;
    return {...metadata,paths,demo,cost};
  }finally{page.destroy();}
}

function sheetMetadata(page:pdf.Page,{x0,y0,x1,y1,point}:ReturnType<typeof pageGeometry>){
    const labels:{text:string;bounds:pdf.Rect}[]=[];
    let rasterCoverage=0;
    const text=page.toStructuredText('preserve-images');
    try{
      let line='', bounds:pdf.Rect=[0,0,0,0];
      text.walk({
        beginLine(b){line='';bounds=[b[0]-x0,b[1]-y0,b[2]-x0,b[3]-y0];},
        onChar(c,_origin,font){font.destroy();line+=c;},
        endLine(){if(line.trim()) labels.push({text:line.trim(),bounds});},
        onImageBlock(b,_matrix,image){image.destroy();rasterCoverage+=Math.max(0,Math.min(x1,b[2])-Math.max(x0,b[0]))*Math.max(0,Math.min(y1,b[3])-Math.max(y0,b[1]));},
      });
    }finally{text.destroy();}
    const annots=page instanceof pdf.PDFPage ? page.getAnnotations() : [];
    try{
      const annotations=annots.map(a=>{
        const type=a.getType(), obj=a.getObject();
        let xref:number;
        try{xref=obj.asIndirect();}finally{obj.destroy();}
        const [l,t,r,b]=a.getBounds();
        const points=(type==='Line'?a.getLine():type==='Polygon'||type==='PolyLine'?a.getVertices():
          type==='Circle'?[[(l+r)/2,(t+b)/2] as Point]:[]).map(([x,y])=>point(x,y,pdf.Matrix.identity));
        return {type,xref,text:a.getContents().trim(),points};
      });
      return {labels,annotations,raster:rasterCoverage>=(x1-x0)*(y1-y0)*.5,width:x1-x0,height:y1-y0};
    }finally{for(const a of annots)a.destroy();}
}
function detectedScale({annotations,labels,width,height}:Pick<Awaited<ReturnType<typeof extractSheet>>,
  'annotations'|'labels'|'width'|'height'>) {
  const bars=annotations.flatMap(a=>{
    const m=bar.exec(a.text);
    return m && a.type==='Line' && a.points.length===2 && distance(a.points[0],a.points[1])>0 && Number(m[1])>0 ?
      [{points:a.points as [Point,Point],feet:Number(m[1]),source:`Scale bar xref ${a.xref}`}] : [];
  });
  return {scale:bars.length===1?bars[0]:bars.length===0?printedScale(labels,width,height):undefined,
    multipleBars:bars.length>1};
}
function detectedScopes(labels:Awaited<ReturnType<typeof extractSheet>>['labels']) {
  return [...new Set(labels.flatMap(label=>{
    const text=label.text.replace(/^\(E\)\s*/i,'');
    const scope=demolitionLegend(text)??(/ceiling (?:partial )?demolition area/i.test(text)?'ceiling':undefined);
    return scope?[scope]:[];
  }))];
}
export async function vectors(id:string,file:Blob,index:number,preview?:(value:{scale?:Calibration;scopeHints:Scope[];paths:SnapPath[]})=>void) {
  const doc=await document(id,file);
  selectSheet(index);
  const page=doc.loadPage(index);
  try{
    const geometry=pageGeometry(page);
    const data=sheetCache.get(index)??(previewMetadata??=sheetMetadata(page,geometry));
    const scale=detectedScale(data).scale;
    const scopeHints=detectedScopes(data.labels);
    // A separate, bounded snap model. Keep discovering styles after the
    // segment budget is spent without walking or retaining those paths.
    const paths:SnapPath[]=[];
    const styles=new Set<string>();
    let remaining=15000;
    let previewSize=0;
    const sendPreview=()=>{
      if(!preview||previewSize)return;
      previewSize=paths.length;
      preview({scale,scopeHints,paths});
    };
    walkContents(page,{
      strokePath(path,stroke,m,cs,components,alpha){
        try {
          if(alpha<=0)return;
          const color=strokeColor(cs,components)||null;
          const dashed=!!stroke.getDashes()?.length;
          const key=color+'/'+dashed;
          if(!remaining&&styles.has(key))return;
          const items:SnapPath['items']=[];
          if(remaining){
            const point=(x:number,y:number)=>geometry.point(x,y,m);
            let last:Point,start:Point;
            path.walk({
              moveTo(x,y){if(remaining)last=start=point(x,y);},
              lineTo(x,y){
                if(!remaining)return;
                const end=point(x,y);
                items.push(['l',[last,end]]);last=end;remaining--;
              },
              curveTo(a,b,c,d,x,y){
                if(!remaining)return;
                const end=point(x,y);
                items.push(['c',[last,point(a,b),point(c,d),end]]);last=end;remaining--;
              },
              closePath(){last=start;},
            });
          }
          paths.push({color,dashed,items});
          styles.add(key);
          if(!remaining)sendPreview();
        }finally{path.destroy();stroke.destroy();cs.destroy();}
      },
    });
    return {scale,scopeHints,paths:paths.slice(previewSize)};
  }finally{page.destroy();}
}

export async function run(id:string,file:Blob,index:number,input:{calibration?:Calibration;rules:Rule[]},
  send:(kind:string,data:unknown)=>void) {
  const doc=await document(id,file);
  selectSheet(index);
  const {paths,labels,annotations,demo,raster,width,height}=extract(doc,index);
  const grouped=new Map<string,number>(), marks=new Set<string>();
  function warn(...messages:string[]){
    for(const message of messages){
      const key=message.replace(/^(?:Vector |Style rule |Tagged annotation |Annotation xref ).*?: /,'');
      grouped.set(key,(grouped.get(key)??0)+1);
    }
  }
  send('scopeHints',detectedScopes(labels));
  const detected=detectedScale({annotations,labels,width,height});
  const calibration=input.calibration??detected.scale;
  if(calibration&&!input.calibration)send('scale',calibration);
  if(detected.multipleBars&&!input.calibration)warn('Multiple tagged scale bars. Confirm scale manually.');
  function emit(scope:Scope, tool:Item['tool'], points:Point[], source:string, key:string, thickness:number|null) {
    const item:Item={id:`auto-${index}-${key}`,sheet:index,scope,tool,points,source,thickness,status:'review',edited:false};
    if(points.some(([x,y])=>x<0||y<0||x>width+.001||y>height+.001) ||
       !measure(item,{feet:1,points:[[0,0],[1,0]],source:'geometry check'})){
      warn(`${source}: unsupported or invalid geometry for ${scope}.`);return;
    }
    const signature=JSON.stringify([scope,points.slice().sort()]);
    if(marks.has(signature)){warn(`${source}: duplicate geometry omitted.`);return;}
    marks.add(signature);
    if(scope==='slab'&&!thickness)warn(`${source}: slab volume requires verified thickness.`);
    send('measurement',item);
  }
  for(const a of annotations){
    const match=tag.exec(a.text);
    const scope=match?scopeOf(match[1]):demolitionLegend(a.text);
    const tool=({Line:'line',PolyLine:'polyline',Polygon:'polygon',Circle:'count'} as const)[a.type as 'Line'];
    if(scope&&tool)emit(scope,tool,a.points,`Tagged annotation xref ${a.xref}`,`a${a.xref}`,Number(match?.[2])||null);
    else if(/^A2Z TAKEOFF:/i.test(a.text))warn(`Annotation xref ${a.xref}: unsupported geometry or scope tag.`);
  }
  const foot = factor(calibration);
  const keyed = foot&&!raster ? keyedDemolition(paths,labels,1/foot) : undefined;
  const keyedDoors=keyed?.candidates.some(mark=>mark.scope==='door');
  const styles=new Map<string,Map<string,{scope:Scope;thickness:number|null}>>();
  const swatches=new Set<number>();
  const map=(color:string,dashed:boolean,scope:Scope,thickness:number|null,paint:Stroke['paint']='stroke')=>{
    const key=`${paint}/${color.toLowerCase()}/${dashed}`;
    const matches=styles.get(key)??new Map();
    matches.set(`${scope}/${thickness}`,{scope,thickness});
    styles.set(key,matches);
  };
  for(const rule of input.rules)map(rule.color,rule.dashed,rule.scope,null);
  const namedLegend=labels.filter(label=>/^(?:DEMOLITION|DEMO|GRADING|EARTHWORK|EXCAVATION) LEGENDS?$/i.test(label.text.trim()));
  for(const label of labels){
    const match=legend.exec(label.text);
    const scope=match?scopeOf(match[1]):demolitionLegend(label.text);
    if(!scope)continue;
    if(!match&&scope==='door'&&keyedDoors)continue;
    if(!match&&scope==='grading'&&!labels.some(l=>/\b(?:grading|earthwork|excavation) (?:plan|legend)\b/i.test(l.text)))continue;
    if(!match&&raster&&scope==='wall')continue;
    const [left,top,,bottom]=label.bounds;
    // Ordinary notes are only considered in a demolition legend column.
    if(!match&&!namedLegend.some(heading=>top>=heading.bounds[3]&&top-heading.bounds[3]<=260&&
      left>=heading.bounds[0]-20&&left<=heading.bounds[2]+150))continue;
    const options=paths.filter(p=>{
      const [x,y,r,b]=p.bounds;
      const gap=left-r, middle=(y+b)/2;
      if(!p.color||gap<0||gap>(match?36:110)||middle<top-3||middle>bottom+3)return false;
      if(match)return true;
      return p.simple&&(r-x>=5||b-y>=5)&&r-x<=120&&b-y<=42;
    });
    for(const option of options)swatches.add(option.seq);
    if(options.length===1){
      const p=options[0];
      map(p.color,p.dashed,scope,Number(match?.[2])||null,p.paint);
    }else if(match||options.length)warn(`Legend swatch ambiguous or absent for ${label.text}.`);
  }
  if(styles.size)for(const path of paths){
    const rules=styles.get(`${path.paint}/${path.color}/${path.dashed}`);
    if(!rules||swatches.has(path.seq))continue;
    const source=`Style rule ${path.color} ${path.dashed?'dashed':'solid'}, vector ${path.seq}`;
    if(rules.size!==1){warn(`${source}: competing rules.`);continue;}
    const {scope,thickness}=rules.values().next().value!;
    if(!path.simple){warn(`unsupported geometry for ${scope}.`);continue;}
    const pts=path.points;
    const returns=pts.length>1&&distance(pts[0],pts.at(-1)!)<=.01;
    if(returns)pts.pop();
    const closed=path.closed||returns;
    const unit=scopes[scope][1];
    if(unit==='LF'&&!closed&&pts.length>=2)emit(scope,pts.length===2?'line':'polyline',pts,source,`${path.paint==='fill'?'f':'v'}${Math.abs(path.seq)}`,thickness);
    else if(unit==='SF'&&closed&&pts.length>=3)emit(scope,'polygon',pts,source,`${path.paint==='fill'?'f':'v'}${Math.abs(path.seq)}`,thickness);
    else if(unit==='EA'&&closed&&pts.length===4&&pts.every(([x,y])=>
      (x===path.bounds[0]||x===path.bounds[2])&&(y===path.bounds[1]||y===path.bounds[3]))){
      const [l,t,r,b]=path.bounds;
      emit(scope,'count',[[(l+r)/2,(t+b)/2]],source,`${path.paint==='fill'?'f':'v'}${Math.abs(path.seq)}`,thickness);
    } else warn(`${source}: unsupported geometry for ${scope}.`);
  }
  if(demo==='Demolition Floor Plan'&&!input.rules.some(rule=>rule.scope==='wall')){
    for(const [i,points] of cadWallRuns(paths).entries())emit('wall','line',points,
      'Paired wall edges on CAD A-DEMO layer · check limits against keyed notes',`cad-wall-${i}`,null);
    warn('CAD floor demo layers also contain fixtures, doors, finishes and relocation marks. Follow the keyed notes to measure these separately.');
  }
  if(demo==='Demolition Ceiling Plan')warn('CAD ceiling demo layer mixes removal boundaries with fixtures and relocation marks. Trace ceiling areas from the keyed notes.');
  const dashedLegend=labels.find(l=>/^EXISTING CONSTRUCTION TO BE REMOVED$/i.test(l.text));
  if(dashedLegend&&labels.some(l=>/^DEMO(?:LITION)? LEGEND$/i.test(l.text))&&
    !input.rules.some(rule=>rule.scope==='wall')){
    const partitions=dashedPartitions(paths,dashedLegend.bounds);
    for(const [i,points] of partitions.entries())emit('wall','line',points,
      'Paired dashed removal outlines · verify partition and endpoints',`d${i}`,null);
    if(partitions.length)warn('Dashed partition lengths are review candidates. Verify endpoints, doors, finishes, and note-based removals separately.');
  }
  if(keyed){
    for(const mark of keyed.candidates){
      if(!input.rules.some(rule=>rule.scope===mark.scope))
        emit(mark.scope,mark.tool,mark.points,mark.source,mark.key,null);
    }
    for(const warning of keyed.warnings)warn(warning);
  }
  const hatchScopes = new Map<Scope,typeof labels[number]>();
  for(const label of labels){
    const name=label.text.replace(/^\(E\)\s*/i,'').trim();
    const match=/^(CEILING|FLOOR(?:ING)?|(?:CONCRETE )?SLAB) (?:PARTIAL )?DEMOLITION AREA$/i.exec(name);
    if(match){
      const scope:Scope=/^ceiling/i.test(match[1])?'ceiling':/^floor/i.test(match[1])?'floor':'slab';
      hatchScopes.set(scope,label);
    }
  }
  for(const [scope,label] of hatchScopes){
    if(input.rules.some(rule=>rule.scope===scope)||!labels.some(l=>/LEGENDS?$/i.test(l.text)))continue;
    const result=hatchAreas(paths,label.bounds);
    if(!result)continue;
    for(const [i,points] of result.candidates.entries())
      emit(scope,'polygon',points,`Estimated area from repeated vector hatch · ${label.text}`,`h-${scope}-${i}`,null);
    if(result.candidates.length)warn(`${scopes[scope][0]} hatch areas are approximate. Verify boundaries and any openings before approval.`);
    if(result.unsupported)warn(`${result.unsupported} hatched region(s) had openings or complex outlines. Trace those manually.`);
  }
  const wallLegend=labels.find(label=>/^WALL(?:S)?\s+TO\s+BE\s+(?:DEMO(?:LISHED)?|REMOVED)\.?$/i.test(label.text));
  const floorPlan=labels.some(label=>/^DEMO(?:LITION)?\s+FLOOR\s+PLAN$/i.test(label.text));
  const redSwatch=wallLegend&&paths.filter(path=>path.color==='#ff0000'&&
    path.bounds[2]<wallLegend.bounds[0]&&wallLegend.bounds[0]-path.bounds[2]<120&&
    path.bounds[1]>=wallLegend.bounds[1]-22&&path.bounds[3]<=wallLegend.bounds[3]+22).length>=5;
  if(raster&&wallLegend&&floorPlan&&redSwatch&&!input.rules.some(rule=>rule.scope==='wall')){
    let candidates=rasterCache.get(index);
    if(!candidates){
      const page=doc.loadPage(index);
      try {
      const [x0,y0]=page.getBounds('CropBox');
      const left=Math.ceil(Math.max(wallLegend.bounds[2]+20,width*.22));
      const right=Math.floor(width*.83), top=Math.floor(height*.025), bottom=Math.floor(height*.96);
      const scale=Math.min(2,4000/Math.max(right-left,bottom-top));
      if(right>left&&bottom>top){
        const x=Math.floor((x0+left)*scale), y=Math.floor((y0+top)*scale);
        const pix=new pdf.Pixmap(pdf.ColorSpace.DeviceRGB,[x,y,Math.ceil((x0+right)*scale),Math.ceil((y0+bottom)*scale)],false);
        const device=new pdf.DrawDevice(pdf.Matrix.identity,pix);
        try{
          pix.clear(255);
          page.runPageContents(device,pdf.Matrix.scale(scale,scale));
          device.close();
          const pairs=wallPairs(pix.getPixels(),pix.getWidth(),pix.getHeight(),pix.getStride(),pix.getNumberOfComponents());
          candidates=pairs.map(points=>points.map(([u,v])=>[(u+x)/scale-x0,(v+y)/scale-y0]) as [Point,Point]);
        }finally{device.destroy();pix.destroy();}
      }
      }finally{page.destroy();}
      if(rasterCache.size>=3)rasterCache.delete(rasterCache.keys().next().value!);
      rasterCache.set(index,candidates??[]);
    }
    for(const [i,points] of (candidates??[]).entries())emit('wall','line',points,
      'Red paired wall outlines · WALL TO BE DEMO legend',`r${i}`,null);
    if(candidates?.length)warn('Verify wall candidates against the drawing. Trace omitted diagonal, short, or interrupted walls manually. Doors and cubicles require separate review.');
    else warn('The wall legend matched, but no reliable paired red outlines were found.');
  }else if(raster)warn('Raster backdrop detected. Calibrate and trace raster geometry manually.');
  if(marks.size&&!calibration)warn('Calibrate this sheet with a verified dimension before approving lengths or areas.');
  if(!marks.size){
    const sheetName=doc.loadPage(index);
    try{
      if(/mechanical demo/i.test(sheetName.getLabel()))
        warn('Mechanical demolition: verify duct runs, disconnect points and associated devices manually.');
      else warn('No supported demolition geometry matched. Use manual tools or define a verified vector style rule.');
    }finally{sheetName.destroy();}
  }
  send('warnings',[...grouped].slice(0,8).map(([message,count])=>count===1?message:`${message} (${count})`));
}

export async function renderLarge(id:string,file:Blob,index:number,scale:number){
  const doc=await document(id,file);
  selectSheet(index);
  const page=doc.loadPage(index);
  try{
    const pix=page.toPixmap(pdf.Matrix.scale(scale,scale),pdf.ColorSpace.DeviceRGB,false,true);
    try{return new Blob([pix.asPNG().buffer as ArrayBuffer],{type:'image/png'});}
    finally{pix.destroy();}
  }finally{page.destroy();}
}
