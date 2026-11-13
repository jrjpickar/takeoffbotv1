import { authenticated, matches, passcode, reply, sessionCookie } from '../auth.mjs';

export default async function handler(request) {
  const secret=passcode();
  if (!secret) return reply({detail:'Set ESTIMATING_BOT_PASSCODE in the sandbox site’s Netlify Functions environment.'},503);
  if (request.method==='GET') return reply({authenticated:authenticated(request,secret)});
  if (request.method!=='POST') return reply({detail:'Method not allowed.'},405,{Allow:'GET, POST'});
  try {
    const body=await request.text();
    if(body.length>8192) return reply({detail:'Passcode input is too large.'},413);
    const {passcode:submitted}=JSON.parse(body);
    if(typeof submitted!=='string'||!matches(submitted,secret,secret)) return reply({detail:'Incorrect passcode.'},401);
    return reply({authenticated:true},200,{'Set-Cookie':sessionCookie(secret)});
  } catch {
    return reply({detail:'Invalid passcode request.'},400);
  }
}
