const limit=100*1024*1024;
export async function planFiles(file:File) {
  if(file.size>limit)throw new Error('PDF or ZIP exceeds 100 MiB.');
  if(!/\.zip$/i.test(file.name))return [file];
  const {BlobReader,ZipReader}=await import('@zip.js/zip.js');
  const reader=new ZipReader(new BlobReader(file));
  try{
    const entries=(await reader.getEntries()).filter(entry=>!entry.directory&&/\.pdf$/i.test(entry.filename)&&
      !entry.filename.split(/[\\/]/).some(part=>part==='__MACOSX'||part.startsWith('._')));
    if(!entries.length)throw new Error('The ZIP contains no PDF plans.');
    if(entries.length>20||entries.reduce((sum,entry)=>sum+entry.uncompressedSize,0)>limit)
      throw new Error('Use at most 20 PDFs and 100 MiB uncompressed per ZIP.');
    const files:File[]=[];
    let bytes=0;
    for(const entry of entries){
      if(entry.directory)continue;
      const parts:ArrayBuffer[]=[];
      const destination=new WritableStream<Uint8Array>({
        write(chunk){
          bytes+=chunk.byteLength;
          if(bytes>limit)throw new Error('ZIP exceeded 100 MiB during extraction.');
          parts.push(Uint8Array.from(chunk).buffer);
        },
      });
      await entry.getData(destination,{checkSignature:true});
      files.push(new File(parts,entry.filename.split(/[\\/]/).at(-1)!,{type:'application/pdf'}));
    }
    return files;
  }finally{await reader.close();}
}
