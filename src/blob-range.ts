import { PDFDataRangeTransport } from 'pdfjs-dist';

export class BlobRange extends PDFDataRangeTransport {
  private stopped=false;
  constructor(private file:Blob,private onFailure:(error:unknown)=>void){
    super(file.size,new Uint8Array(),true);
  }
  override requestDataRange(begin:number,end:number){
    void this.file.slice(begin,end).arrayBuffer().then(bytes=>{
      if(!this.stopped)this.onDataRange(begin,new Uint8Array(bytes));
    }).catch(error=>{if(!this.stopped)this.onFailure(error);});
  }
  override abort(){this.stopped=true;}
}
