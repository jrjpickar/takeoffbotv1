import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const cookieName = '__Host-a2z_sandbox';
const lifetime = 12 * 60 * 60;
const now = () => Math.floor(Date.now() / 1000);
export const passcode = () => process.env.ESTIMATING_BOT_PASSCODE;
const sign = (value, secret) => createHmac('sha256',secret).update(value).digest('hex');
export const matches = (left,right,secret) =>
  timingSafeEqual(Buffer.from(sign(left,secret),'hex'),Buffer.from(sign(right,secret),'hex'));

export function authenticated(request, secret) {
  const cookie = request.headers.get('cookie')?.split(';').map(value=>value.trim())
    .find(value=>value.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  const parts = /^(\d{1,12})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(cookie ?? '');
  if(!parts || Number(parts[1])<=now() || Number(parts[1])>now()+lifetime) return false;
  return matches(parts[3],sign(parts[1]+'.'+parts[2],secret),secret);
}

export function sessionCookie(secret) {
  const payload = (now()+lifetime)+'.'+randomBytes(16).toString('hex');
  return `${cookieName}=${payload}.${sign(payload,secret)}; Max-Age=${lifetime}; Path=/; Secure; HttpOnly; SameSite=Strict`;
}

export const reply = (value,status=200,headers={}) =>
  Response.json(value,{status,headers:{'Cache-Control':'no-store',...headers}});
