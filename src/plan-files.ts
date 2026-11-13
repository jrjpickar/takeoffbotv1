const limit=1024*1024*1024;
export async function planFiles(file:File,cleanup:(()=>Promise<void>)[]=[]) {
  if(file.size>limit)throw new Error('PDF or ZIP exceeds 1 GiB.');
  if(!/\.zip$/i.test(file.name))return [file];
  const {BlobReader,ZipReader}=await import('@zip.js/zip.js');
  const reader=new ZipReader(new BlobReader(file));
  try{
    const entries=(await reader.getEntries()).filter(entry=>!entry.directory&&/\.pdf$/i.test(entry.filename)&&
      !entry.filename.split(/[\\/]/).some(part=>part==='__MACOSX'||part.startsWith('._')));
    if(!entries.length)throw new Error('The ZIP contains no PDF plans.');
    if(entries.length>20||entries.reduce((sum,entry)=>sum+entry.uncompressedSize,0)>limit)
      throw new Error('Use at most 20 PDFs and 1 GiB uncompressed per ZIP.');
    const files:File[]=[];
    let bytes=0;
    for(const entry of entries){
      if(entry.directory)continue;
      const name=entry.filename.split(/[\\/]/).at(-1)!;
      const parts:ArrayBuffer[]=[];
      // Use a disk-backed temporary file when available so large ZIPs do not retain all inflated chunks in RAM.
      const directory=entry.uncompressedSize>128*1024*1024
        ? await navigator.storage.getDirectory() : undefined;
      const temp=directory&&await directory.getFileHandle(`a2z-${crypto.randomUUID()}.pdf`,{create:true});
      if(temp&&directory)cleanup.push(()=>directory.removeEntry(temp.name));
      const writer=await temp?.createWritable();
      try{
        const destination=new WritableStream<Uint8Array>({
          async write(chunk){
            bytes+=chunk.byteLength;
            if(bytes>limit)throw new Error('ZIP exceeded 1 GiB during extraction.');
            const data=Uint8Array.from(chunk).buffer;
            if(writer)await writer.write(data);
            else parts.push(data);
          },
        });
        await entry.getData(destination,{checkSignature:true});
        if(writer&&temp){
          await writer.close();
          // The stored Blob retains the file data. Cleanup is deferred until IndexedDB commits.
          const diskFile=await temp.getFile();
          files.push(new File([diskFile],name,{type:'application/pdf'}));
        }else files.push(new File(parts,name,{type:'application/pdf'}));
      }catch(error){await writer?.abort().catch(()=>{});throw error;}

    }
    return files;
  }finally{await reader.close();}
}
