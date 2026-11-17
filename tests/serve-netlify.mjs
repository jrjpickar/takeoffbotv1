import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { preview } from 'vite';
import price from '../netlify/sandbox-functions/price.mjs';
import session from '../netlify/sandbox-functions/session.mjs';
import keynote, {handleKeynote} from '../netlify/sandbox-functions/keynote.mjs';

process.env.ESTIMATING_BOT_PASSCODE='local-browser-test-only';

const mockGroq=process.env.A2Z_MOCK_GROQ==='1';
if(mockGroq)process.env.GROQ_API_KEY='test-only-credential';
const keynoteHandler=mockGroq?request=>handleKeynote(request,async(url,options)=>{
  const payload=JSON.parse(options.body);
  const notes=JSON.parse(payload.messages[1].content);
  if(url!=='https://api.groq.com/openai/v1/chat/completions'||payload.model!=='openai/gpt-oss-120b'||
    options.headers.Authorization!=='Bearer test-only-credential'||payload.max_completion_tokens!==350||
    !payload.response_format.json_schema.strict||notes.some(note=>Object.keys(note).sort().join(',')!=='id,note,object')){
    return Response.json({}, {status:400});
  }
  return Response.json({
    choices:[{finish_reason:'stop',message:{content:JSON.stringify(Object.fromEntries(notes.map(note=>[note.id,'uncertain'])))}}],
    usage:{total_tokens:123},
  });
}):keynote;

await preview({preview:{host:'127.0.0.1',port:8766,strictPort:true}});
const proxy = createServer(async (req,res)=>{
  const handler=({'/.netlify/functions/price':price,'/.netlify/functions/session':session,'/.netlify/functions/keynote':keynoteHandler})[req.url];
  if(handler){
    const response=await handler(new Request('http://127.0.0.1:8765'+req.url,{
      method:req.method,headers:req.headers,body:req.method==='POST'?Readable.toWeb(req):undefined,duplex:'half',
    }));
    res.writeHead(response.status,Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  const response=await fetch('http://127.0.0.1:8766'+req.url);
  res.writeHead(response.status,{'Content-Type':response.headers.get('content-type')??'application/octet-stream'});
  res.end(Buffer.from(await response.arrayBuffer()));
});
proxy.listen(8765,'127.0.0.1');
