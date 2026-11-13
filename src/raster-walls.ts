import type { Point } from './domain';

type Band={first:number;last:number;lo:number;hi:number};
export function wallPairs(rgb:Uint8ClampedArray,width:number,height:number,stride:number,components:number) {
  const red=new Uint8Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=y*stride+x*components;
    red[y*width+x]=Number(rgb[p]>165&&rgb[p]-rgb[p+1]>65&&rgb[p]-rgb[p+2]>65);
  }
  const results:[Point,Point][]=[];
  for(const vertical of [false,true]){
    const rows=vertical?width:height, columns=vertical?height:width;
    const bands:Band[]=[];
    for(let y=0;y<rows;y++){
      let start=-1,last=-20,count=0;
      const finish=()=>{
        if(last-start<44||count/(last-start+1)<.45)return;
        const band=bands.findLast(b=>y-b.last<=1&&Math.abs(b.lo-start)<=10&&Math.abs(b.hi-last)<=10);
        if(band)band.last=y;
        else bands.push({first:y,last:y,lo:start,hi:last});
      };
      for(let x=0;x<columns;x++){
        if(!red[vertical?x*width+y:y*width+x])continue;
        if(x-last>14){finish();start=x;count=0;}
        last=x;count++;
      }
      finish();
    }
    const candidates:{a:Band;b:Band;lo:number;hi:number;score:number}[]=[];
    const thick=bands.filter(b=>b.last>b.first);
    for(let i=0;i<thick.length;i++)for(let j=i+1;j<thick.length;j++){
      const a=thick[i],b=thick[j],gap=(b.first+b.last-a.first-a.last)/2;
      if(gap>32)break;
      if(gap<7)continue;
      const lo=Math.max(a.lo,b.lo),hi=Math.min(a.hi,b.hi);
      if(hi-lo<44||hi-lo<.80*Math.max(a.hi-a.lo,b.hi-b.lo))continue;
      if(Math.abs(a.lo-b.lo)>20||Math.abs(a.hi-b.hi)>20)continue;
      candidates.push({a,b,lo,hi,score:Math.abs(a.lo-b.lo)+Math.abs(a.hi-b.hi)});
    }
    const used=new Set<Band>();
    for(const {a,b,lo,hi} of candidates.sort((a,b)=>a.score-b.score)){
      if(used.has(a)||used.has(b))continue;
      used.add(a);used.add(b);
      const center=(a.first+a.last+b.first+b.last)/4;
      results.push(vertical?[[center,lo],[center,hi]]:[[lo,center],[hi,center]]);
    }
  }
  return results;
}
