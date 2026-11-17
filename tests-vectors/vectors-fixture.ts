import {planFiles} from '../src/plan-files';
import type {Rule,Sheet} from '../src/domain';

type Event={job:number;kind:string;data:any};
const worker=new Worker(new URL('../src/hosted.worker.ts',import.meta.url),{type:'module'});
let nextJob=0;
function request(action:string,id:string,file:Blob,index=0,rules:Rule[]=[],scale=1){
  return new Promise<Event[]>((resolve,reject)=>{
    const job=++nextJob,events:Event[]=[];
    const cleanup=()=>{
      worker.removeEventListener('message',message);
      worker.removeEventListener('error',error);
    };
    const error=(e:ErrorEvent)=>{cleanup();reject(new Error(e.message||'Worker error'));};
    function message({data}:MessageEvent<Event>){
      if(data.job!==job)return;
      if(data.kind==='failed'){cleanup();reject(new Error(data.data));}
      else if(data.kind==='done'){cleanup();resolve(events);}
      else events.push(data);
    }
    worker.addEventListener('error',error);
    worker.addEventListener('message',message);
    worker.postMessage({job,action,id,file,index,input:{rules},scale});
  });
}
const result=(events:Event[])=>events.find(e=>e.kind==='result')!.data;
const cut=(events:Event[])=>({
  marks:events.filter(e=>e.kind==='measurements').flatMap(e=>e.data),
  scale:events.find(e=>e.kind==='scale')?.data,
  warnings:events.find(e=>e.kind==='warnings')?.data,
});

function fixture(backgrounds:number[],offset=0){
  const contents=(n:number,i:number)=>{
    const y=40+i*24+offset;
    return '0 0 1 RG 10 80 m 20 85 30 85 40 80 c S\n'
      +'0 1 0 RG 10 100 m 20 100 l 35 100 m 45 100 l S\n'
      +'0 G 2 5 m 3 6 l S\n'.repeat(n)
      +`1 0 0 RG [4 2] 0 d 20 ${y} m 70 ${y} l 70 ${y+10} l S\n`
      +'[] 0 d 1 0 0 RG 20 120 m 30 120 l 50 125 m 60 125 l S\n'
      +'1 0 0 RG 20 130 m 30 135 40 135 50 130 c S\n'
      +'0.2 0.5 0.8 rg 90 40 20 20 re f\n'
      +'BT /F1 5 Tf 1 0 0 1 114 48 Tm (A2Z LEGEND: floor) Tj ET\n'
      +'BT /F1 5 Tf 1 0 0 1 190 48 Tm (unused) Tj ET\n'
      +'0.2 0.5 0.8 rg 90 80 20 20 re f\n';
  };
  const objs=['<< /Type /Catalog /Pages 2 0 R >>','',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids=backgrounds.map((n,i)=>{
    const page=objs.length+1, content=contents(n,i);
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 160] /Resources << /Font << /F1 3 0 R >> >> /Contents ${page+1} 0 R /Annots [${page+2} 0 R ${page+3} 0 R] >>`,
      `<< /Length ${content.length} >>\nstream\n${content}endstream`,
      '<< /Type /Annot /Subtype /Line /Rect [5 10 26 16] /L [5 12 25 12] /Contents (A2Z SCALE BAR: 10 FT) >>',
      '<< /Type /Annot /Subtype /Line /Rect [5 20 26 26] /L [5 22 25 22] /Contents (A2Z TAKEOFF: wall) >>');
    return `${page} 0 R`;
  });
  objs[1]=`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
  const parts=['%PDF-1.7\n'], offsets=[0];
  let at=parts[0].length;
  objs.forEach((body,i)=>{
    offsets.push(at);
    const obj=`${i+1} 0 obj\n${body}\nendobj\n`;
    parts.push(obj);at+=obj.length;
  });
  parts.push(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`,
    ...offsets.slice(1).map(x=>`${String(x).padStart(10,'0')} 00000 n \n`),
    `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`);
  return new Blob(parts,{type:'application/pdf'});
}
const rules:Rule[]=[{scope:'wall',color:'#ff0000',dashed:true},{scope:'wall',color:'#ff0000',dashed:false}];
async function pixel(blob:Blob,x:number,y:number){
  const image=await createImageBitmap(blob);
  try{
    const canvas=new OffscreenCanvas(1,1);
    const ctx=canvas.getContext('2d')!;
    ctx.drawImage(image,-x,-y);
    return {width:image.width,height:image.height,rgba:[...ctx.getImageData(0,0,1,1).data]};
  }finally{image.close();}
}
const api={
  async synthetic(){
    const dense=fixture([500000,125000]),other=fixture([0],12);
    const t=performance.now();
    const info=result(await request('sheets','dense',dense)) as Sheet[];
    const preview=result(await request('vectors','dense',dense));
    const previewMs=Math.round(performance.now()-t);
    const started=performance.now();
    const first=cut(await request('run','dense',dense,0,rules));
    const takeoffMs=Math.round(performance.now()-started);
    const second=cut(await request('run','dense',dense,1,rules));
    const later=cut(await request('run','other',other,0,rules));
    const revisit=cut(await request('run','dense',dense,0,rules));
    const image=result(await request('render','dense',dense,0,[],2));
    return {count:info.length,scale:preview.scale,segments:preview.paths.reduce((n:number,p:any)=>n+p.items.length,0),
      curve:preview.paths.find((p:any)=>p.color==='#0000ff').items,
      disconnected:preview.paths.find((p:any)=>p.color==='#00ff00').items,
      lateStyle:preview.paths.find((p:any)=>p.color==='#ff0000'&&p.dashed),
      first,second,later,revisit,previewMs,takeoffMs,render:await pixel(image,200,140)};
  },
  async exact(){
    const input=document.querySelector('input')!;
    const [file]=await planFiles(input.files![0]);
    const t=performance.now();
    const info=result(await request('sheets','exact',file)) as Sheet[];
    const openMs=Math.round(performance.now()-t);
    const pages=[];
    let diagnosticMarks:unknown[]=[];
    for(const [index,sheet] of info.entries()){
      const start=performance.now();
      // An explicit diagnostic style from sheet 14 yields two lines, one
      // from well beyond the former cutoff. It is not a scope recommendation.
      const diagnostic:Rule[]=index===13?[{scope:'wall',color:'#858585',dashed:false}]:[];
      const extracted=cut(await request('run','exact',file,index,diagnostic));
      if(diagnostic.length)diagnosticMarks=extracted.marks;
      const runMs=Math.round(performance.now()-start);
      const scale=1024/Math.max(sheet.width,sheet.height);
      const image=result(await request('render','exact',file,index,[],scale)) as Blob;
      const rendered=await pixel(image,0,0);
      let snap:number|undefined;
      if([0,5,7,10,info.length-1].includes(index)){
        const preview=result(await request('vectors','exact',file,index));
        snap=preview.paths.reduce((n:number,p:any)=>n+p.items.length,0);
      }
      const page={sheet:index+1,title:sheet.name,marks:extracted.marks.length,scale:extracted.scale?.source,
        warnings:extracted.warnings,runMs,ms:Math.round(performance.now()-start),snap,png:image.size,
        rasterWidth:rendered.width,rasterHeight:rendered.height};
      console.log(JSON.stringify(page));
      pages.push(page);
    }
    return {name:file.name,bytes:file.size,openMs,pages,diagnosticMarks};
  },
};
declare global {interface Window {vectorTest:typeof api}}
window.vectorTest=api;
