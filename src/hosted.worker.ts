const engine = import('./hosted-extract');

let queue = Promise.resolve();
self.onmessage = ({data:{job,action,id,file,index,input}}) => {
  queue=queue.then(async()=>{
    const emit=(kind:string,data:unknown)=>self.postMessage({job,kind,data});
    try{
      const {run,sheets,vectors}=await engine;
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
      else emit('result',await (action==='sheets'?sheets(id,file):vectors(id,file,index)));
      emit('done',null);
    }catch(error){emit('failed',error instanceof Error?error.message:'PDF processing failed.');}
  });
};
