import adapter from '../../desk/adapter.cjs';
import { authenticated, passcode, reply } from '../auth.mjs';

export default async function handler(request) {
  if (request.method !== 'POST') return new Response(null,{status:405,headers:{Allow:'POST'}});
  const secret=passcode();
  if(!secret) return reply({detail:'Sandbox passcode is not configured.'},503);
  if(!authenticated(request,secret)) return reply({detail:'Sandbox session expired. Reload and enter the passcode.'},401);
  try {
    const text=await request.text();
    if(text.length>250000) return Response.json({detail:'Pricing request is too large.'},{status:413});
    const {csv,markup,answers}=JSON.parse(text);
    if(typeof csv!=='string' || (markup!==null && (!Number.isFinite(markup)||markup<0))) {
      return Response.json({detail:'Invalid pricing input.'},{status:422});
    }
    const cleanAnswers = Object.fromEntries(Object.entries(answers ?? {}).slice(0,200)
      .filter(([key,value])=>key.length<=160&&typeof value==='string'&&value.length<=40));
    return Response.json(adapter.price({csv,markup,answers:cleanAnswers,name:'Sandbox draft'}),{headers:{'Cache-Control':'no-store'}});
  }catch{
    return Response.json({detail:'Unable to price this takeoff.'},{status:422});
  }
}
