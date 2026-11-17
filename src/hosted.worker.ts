const engine = import('./hosted-extract');

type Job = {job:number;action:string;id:string;file:Blob;index:number;input:Parameters<typeof import('./hosted-extract').run>[3];scale:number;region:Parameters<typeof import('./hosted-extract').renderKeynoteCrop>[3];progressive?:boolean};
const queue:Job[]=[];
let scheduled=false;
let running=false;

function schedule(){
  if(scheduled||running||!queue.length)return;
  scheduled=true;
  // Let incoming navigation and abort messages update the queue before work starts.
  setTimeout(async()=>{
    scheduled=false;
    const index=queue.findIndex(task=>task.action!=='vectors');
    const task=queue.splice(index<0?0:index,1)[0];
    if(!task)return;
    running=true;
    try{await execute(task);}finally{running=false;schedule();}
  },0);
}

self.onmessage=({data})=>{
  if(data.action==='cancel'){
    const index=queue.findIndex(task=>task.job===data.job);
    if(index>=0)queue.splice(index,1);
  }else queue.push(data as Job);
  schedule();
};

async function execute({job,action,id,file,index,input,scale,region,progressive}:Job){
    const emit=(kind:string,data:unknown)=>self.postMessage({job,kind,data});
    try{
      const {run,sheets,vectors,renderLarge,renderKeynoteCrop}=await engine;
      if(action==='run'){
        let batch:unknown[]=[];
        const flush=()=>{if(batch.length){emit('measurements',batch);batch=[];}};
        await run(id,file,index,input,(kind,data)=>{
          if(kind==='measurement'){
            batch.push(data);
            if(batch.length===32)flush();
          }else{flush();emit(kind,data);}
        });
        flush();
      }
      else if(action==='keynote-crop')emit('result',await renderKeynoteCrop(id,file,index,region));
      else if(action==='render')emit('result',await renderLarge(id,file,index,scale));
      else emit('result',await (action==='sheets'?sheets(id,file):vectors(id,file,index,progressive?data=>emit('preview',data):undefined)));
      emit('done',null);
    }catch(error){emit('failed',error instanceof Error?error.message:'PDF processing failed.');}
}
