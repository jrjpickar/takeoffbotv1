import type {Point} from './domain';

// The measurement model keeps one copy of transformed endpoints per sheet.
// Allocate in fixed blocks so a long path never requires resizing/copying a
// large buffer. Decode point objects only for geometry a detector consumes.
const blockSize=16384;
export class VectorPoints {
  private blocks:Float64Array[]=[];
  length=0;
  get bytes(){return this.blocks.length*blockSize*16;}

  push(x:number,y:number){
    const index=this.length%blockSize;
    if(index===0)this.blocks.push(new Float64Array(blockSize*2));
    const block=this.blocks[this.blocks.length-1];
    block[index*2]=x;
    block[index*2+1]=y;
    this.length++;
  }

  read(start:number,count:number):Point[]{
    const points=new Array<Point>(count);
    for(let i=0;i<count;i++){
      const index=start+i;
      const block=this.blocks[Math.floor(index/blockSize)];
      const offset=index%blockSize*2;
      points[i]=[block[offset],block[offset+1]];
    }
    return points;
  }
}
