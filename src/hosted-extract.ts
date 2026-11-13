import { printedScale } from './sheet-scale';
import * as pdf from 'mupdf';
import { hatchAreas } from './hatch-areas';
import { demolitionLegend } from './legend-scope';
import { wallPairs } from './raster-walls';
import { distance, measure, scopes, type Calibration, type Item, type Point, type Rule, type Scope, type Sheet } from './domain';

type Stroke = {paint:'stroke'|'fill';color:string; dashed:boolean; seq:number; items:[string,Point[]][]; points:Point[];
  closed:boolean; simple:boolean; bounds:pdf.Rect};
const tag=/^A2Z TAKEOFF:\s*(\w+)(?:\s+THICKNESS=(\d+(?:\.\d+)?)IN)?$/i;
const legend=/^A2Z LEGEND:\s*(\w+)(?:\s+THICKNESS=(\d+(?:\.\d+)?)IN)?$/i;
const bar=/^A2Z SCALE BAR:\s*(\d+(?:\.\d+)?)\s*FT$/i;
const scopeOf=(key:string)=>Object.hasOwn(scopes,key.toLowerCase()) ? key.toLowerCase() as Scope : undefined;
const rgb=(components:number[]) => '#'+components.map(n=>Math.round(Math.max(0,Math.min(1,n))*255).toString(16).padStart(2,'0')).join('');

let current:{id:string; doc:pdf.Document}|undefined;
async function document(id:string, file:Blob) {
  if(current?.id===id) return current.doc;
  const doc=pdf.Document.openDocument(await file.arrayBuffer(),'application/pdf');
  current?.doc.destroy();
  sheetCache.clear();
  rasterCache.clear();
  current={id,doc};
  return doc;
}
function sheetInfo(page:pdf.Page,index:number):Sheet {
  const [x0,y0,x1,y1]=page.getBounds('CropBox');
  const label=page.getLabel();
  return {name:label ? `Sheet ${index+1} (${label})` : `Sheet ${index+1}`,
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
const sheetCache=new Map<number,Awaited<ReturnType<typeof extractSheet>>>();
async function extract(id:string,file:Blob,index:number) {
  await document(id,file);
  const cached=sheetCache.get(index);
  if(cached)return cached;
  const result=await extractSheet(id,file,index);
  if(sheetCache.size>=3)sheetCache.delete(sheetCache.keys().next().value!);
  sheetCache.set(index,result);
  return result;
}
async function extractSheet(id:string,file:Blob,index:number) {
  const doc=await document(id,file);
  const page=doc.loadPage(index);
  const [x0,y0,x1,y1]=page.getBounds('CropBox');
  const point=(x:number,y:number,m:pdf.Matrix):Point=>[
    Math.round((m[0]*x+m[2]*y+m[4]-x0)*1e4)/1e4,
    Math.round((m[1]*x+m[3]*y+m[5]-y0)*1e4)/1e4,
  ];
  const paths:Stroke[]=[];
  const labels:{text:string;bounds:pdf.Rect}[]=[];
  let rasterCoverage=0, strokeId=0, fillId=0;
  function readPath(path:pdf.Path,m:pdf.Matrix,cs:pdf.ColorSpace,color:number[],alpha:number,
    paint:Stroke['paint'],dashed:boolean){
      if(alpha<=0) return;
      const colorRGB=cs.isRGB()?color:cs.isGray()?Array(3).fill(color[0]):null;
      // Ordinary black and white fills are page backgrounds, not finish swatches.
      if(paint==='fill'&&(!colorRGB||Math.max(...colorRGB)-Math.min(...colorRGB)<.04))return;
      if(paths.length>=120000) throw new Error('This sheet exceeds the vector processing limit. Trace it manually.');
      let moves=0, closed=false, curved=false;
      const points:Point[]=[], items:Stroke['items']=[];
      let last:Point;
      path.walk({
        moveTo(x,y){last=point(x,y,m);points.push(last);moves++;},
        lineTo(x,y){const end=point(x,y,m);items.push(['l',[last,end]]);points.push(end);last=end;},
        curveTo(a,b,c,d,e,f){const end=point(e,f,m);items.push(['c',[last,point(a,b,m),point(c,d,m),end]]);points.push(end);last=end;curved=true;},
        closePath(){closed=true;},
      });
      if(!points.length) return;
      const bounds=points.reduce<pdf.Rect>((r,[x,y])=>[Math.min(x,r[0]),Math.min(y,r[1]),Math.max(x,r[2]),Math.max(y,r[3])],
        [Infinity,Infinity,-Infinity,-Infinity]);
      paths.push({seq:paint==='stroke'?strokeId++:--fillId,paint,color:colorRGB?rgb(colorRGB):'',dashed,
        bounds,items,points,closed,simple:moves===1&&!curved});
  }
  const device=new pdf.Device({
    strokePath(path,stroke,m,cs,color,alpha){readPath(path,m,cs,color,alpha,'stroke',!!stroke.getDashes()?.length);},
    fillPath(path,_,m,cs,color,alpha){readPath(path,m,cs,color,alpha,'fill',false);},
  });
  try {
    page.runPageContents(device,pdf.Matrix.identity);
    device.close();
    const text=page.toStructuredText('preserve-images');
    try{
      let line='', bounds:pdf.Rect=[0,0,0,0];
      text.walk({
        beginLine(b){line='';bounds=[b[0]-x0,b[1]-y0,b[2]-x0,b[3]-y0];},
        onChar(c){line+=c;},
        endLine(){if(line.trim()) labels.push({text:line.trim(),bounds});},
        onImageBlock(b){rasterCoverage+=Math.max(0,Math.min(x1,b[2])-Math.max(x0,b[0]))*Math.max(0,Math.min(y1,b[3])-Math.max(y0,b[1]));},
      });
    }finally{text.destroy();}
    const annotations=page instanceof pdf.PDFPage ? page.getAnnotations().map(a=>{
      const type=a.getType(), obj=a.getObject();
      const xref=obj.asIndirect();
      obj.destroy();
      const [l,t,r,b]=a.getBounds();
      const points=(type==='Line'?a.getLine():type==='Polygon'||type==='PolyLine'?a.getVertices():
        type==='Circle'?[[(l+r)/2,(t+b)/2] as Point]:[]).map(([x,y])=>point(x,y,pdf.Matrix.identity));
      return {type,xref,text:a.getContents().trim(),points};
    }):[];
    return {paths,labels,annotations,raster:rasterCoverage>=(x1-x0)*(y1-y0)*.5,width:x1-x0,height:y1-y0};
  }finally{device.destroy();page.destroy();}
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
export async function vectors(id:string,file:Blob,index:number) {
  const data=await extract(id,file,index);
  const scale=detectedScale(data).scale;
  const scopeHints=detectedScopes(data.labels);
  return {scale,scopeHints,paths:data.paths.filter(p=>p.paint==='stroke').map(({color,dashed,items})=>({color:color||null,dashed,items}))};
}

export async function run(id:string,file:Blob,index:number,input:{calibration?:Calibration;rules:Rule[]},
  send:(kind:string,data:unknown)=>void) {
  const {paths,labels,annotations,raster,width,height}=await extract(id,file,index);
  const warnings:string[]=[], marks=new Set<string>();
  send('scopeHints',detectedScopes(labels));
  const detected=detectedScale({annotations,labels,width,height});
  const calibration=input.calibration??detected.scale;
  if(calibration&&!input.calibration)send('scale',calibration);
  if(detected.multipleBars&&!input.calibration)warnings.push('Multiple tagged scale bars. Confirm scale manually.');
  function emit(scope:Scope, tool:Item['tool'], points:Point[], source:string, key:string, thickness:number|null) {
    const item:Item={id:`auto-${index}-${key}`,sheet:index,scope,tool,points,source,thickness,status:'review',edited:false};
    if(points.some(([x,y])=>x<0||y<0||x>width+.001||y>height+.001) ||
       !measure(item,{feet:1,points:[[0,0],[1,0]],source:'geometry check'})){
      warnings.push(`${source}: unsupported or invalid geometry for ${scope}.`);return;
    }
    const signature=JSON.stringify([scope,points.slice().sort()]);
    if(marks.has(signature)){warnings.push(`${source}: duplicate geometry omitted.`);return;}
    marks.add(signature);
    if(scope==='slab'&&!thickness)warnings.push(`${source}: slab volume requires verified thickness.`);
    send('measurement',item);
  }
  for(const a of annotations){
    const match=tag.exec(a.text);
    const scope=match?scopeOf(match[1]):demolitionLegend(a.text);
    const tool=({Line:'line',PolyLine:'polyline',Polygon:'polygon',Circle:'count'} as const)[a.type as 'Line'];
    if(scope&&tool)emit(scope,tool,a.points,`Tagged annotation xref ${a.xref}`,`a${a.xref}`,Number(match?.[2])||null);
    else if(/^A2Z TAKEOFF:/i.test(a.text))warnings.push(`Annotation xref ${a.xref}: unsupported geometry or scope tag.`);
  }
  const styles=new Map<string,Map<string,{scope:Scope;thickness:number|null}>>();
  const swatches=new Set<number>();
  const map=(color:string,dashed:boolean,scope:Scope,thickness:number|null,paint:Stroke['paint']='stroke')=>{
    const key=`${paint}/${color.toLowerCase()}/${dashed}`;
    const matches=styles.get(key)??new Map();
    matches.set(`${scope}/${thickness}`,{scope,thickness});
    styles.set(key,matches);
  };
  for(const rule of input.rules)map(rule.color,rule.dashed,rule.scope,null);
  const namedLegend=labels.filter(label=>/^(?:DEMOLITION|DEMO) LEGENDS?$/i.test(label.text.trim()));
  for(const label of labels){
    const match=legend.exec(label.text);
    const scope=match?scopeOf(match[1]):demolitionLegend(label.text);
    if(!scope)continue;
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
    }else if(match||options.length)warnings.push(`Legend swatch ambiguous or absent for ${label.text}.`);
  }
  for(const path of paths){
    const rules=styles.get(`${path.paint}/${path.color}/${path.dashed}`);
    if(!rules||swatches.has(path.seq))continue;
    const source=`Style rule ${path.color} ${path.dashed?'dashed':'solid'}, vector ${path.seq}`;
    if(rules.size!==1){warnings.push(`${source}: competing rules.`);continue;}
    const {scope,thickness}=rules.values().next().value!;
    const pts=path.points.slice();
    const returns=pts.length>1&&distance(pts[0],pts.at(-1)!)<=.01;
    const closed=path.closed||returns;
    if(returns)pts.pop();
    const unit=scopes[scope][1];
    if(path.simple&&unit==='LF'&&!closed&&pts.length>=2)emit(scope,pts.length===2?'line':'polyline',pts,source,`${path.paint==='fill'?'f':'v'}${Math.abs(path.seq)}`,thickness);
    else if(path.simple&&unit==='SF'&&closed&&pts.length>=3)emit(scope,'polygon',pts,source,`${path.paint==='fill'?'f':'v'}${Math.abs(path.seq)}`,thickness);
    else if(path.simple&&unit==='EA'&&closed&&pts.length===4&&pts.every(([x,y])=>
      (x===path.bounds[0]||x===path.bounds[2])&&(y===path.bounds[1]||y===path.bounds[3]))){
      const [l,t,r,b]=path.bounds;
      emit(scope,'count',[[(l+r)/2,(t+b)/2]],source,`${path.paint==='fill'?'f':'v'}${Math.abs(path.seq)}`,thickness);
    } else warnings.push(`${source}: unsupported geometry for ${scope}.`);
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
    if(result.candidates.length)warnings.push(`${scopes[scope][0]} hatch areas are approximate. Verify boundaries and any openings before approval.`);
    if(result.unsupported)warnings.push(`${result.unsupported} hatched region(s) had openings or complex outlines. Trace those manually.`);
  }
  const wallLegend=labels.find(label=>/^WALL(?:S)?\s+TO\s+BE\s+(?:DEMO(?:LISHED)?|REMOVED)\.?$/i.test(label.text));
  const floorPlan=labels.some(label=>/^DEMO(?:LITION)?\s+FLOOR\s+PLAN$/i.test(label.text));
  const redSwatch=wallLegend&&paths.filter(path=>path.color==='#ff0000'&&
    path.bounds[2]<wallLegend.bounds[0]&&wallLegend.bounds[0]-path.bounds[2]<120&&
    path.bounds[1]>=wallLegend.bounds[1]-22&&path.bounds[3]<=wallLegend.bounds[3]+22).length>=5;
  if(raster&&wallLegend&&floorPlan&&redSwatch&&!input.rules.some(rule=>rule.scope==='wall')){
    let candidates=rasterCache.get(index);
    if(!candidates){
      const page=(await document(id,file)).loadPage(index);
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
    if(candidates?.length)warnings.push('Verify wall candidates against the drawing. Trace omitted diagonal, short, or interrupted walls manually. Doors and cubicles require separate review.');
    else warnings.push('The wall legend matched, but no reliable paired red outlines were found.');
  }else if(raster)warnings.push('Raster backdrop detected. Calibrate and trace raster geometry manually.');
  if(marks.size&&!calibration)warnings.push('Calibrate this sheet with a verified dimension before approving lengths or areas.');
  if(!marks.size){
    const sheetName=(await document(id,file)).loadPage(index);
    try{
      if(/mechanical demo/i.test(sheetName.getLabel()))
        warnings.push('Mechanical demolition: verify duct runs, disconnect points and associated devices manually.');
      else warnings.push('No supported demolition geometry matched. Use manual tools or define a verified vector style rule.');
    }finally{sheetName.destroy();}
  }
  const grouped=new Map<string,number>();
  for(const warning of warnings){
    const key=warning.replace(/^(?:Vector |Style rule |Tagged annotation |Annotation xref ).*?: /,'');
    grouped.set(key,(grouped.get(key)??0)+1);
  }
  send('warnings',[...grouped].slice(0,8).map(([message,count])=>count===1?message:`${message} (${count})`));
}
