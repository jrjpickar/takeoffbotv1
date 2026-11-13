import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import session from '../netlify/sandbox-functions/session.mjs';
import price from '../netlify/sandbox-functions/price.mjs';

test('Netlify requires a valid passcode and signed session to price',async()=>{
  const secret='unit-test-passcode-only';
  const previous=process.env.ESTIMATING_BOT_PASSCODE;
  const request=(body,cookie)=>new Request('https://sandbox.example/',{
    method:body===undefined?'GET':'POST',body:body===undefined?undefined:JSON.stringify(body),
    headers:cookie?{cookie}:{},
  });
  try{
    delete process.env.ESTIMATING_BOT_PASSCODE;
    assert.equal((await session(request())).status,503);
    assert.equal((await price(request({}))).status,503);
    process.env.ESTIMATING_BOT_PASSCODE=secret;
    assert.equal((await session(request({passcode:'wrong'}))).status,401);
    assert.equal((await price(request({}))).status,401);
    const login=await session(request({passcode:secret}));
    assert.equal(login.status,200);
    const header=login.headers.get('set-cookie');
    assert.match(header,/; Secure; HttpOnly; SameSite=Strict/);
    const cookie=header.split(';')[0];
    assert.equal((await (await session(request(undefined,cookie))).json()).authenticated,true);
    assert.equal((await price(request({},cookie+'x'))).status,401);
    const csv=await readFile(new URL('../samples/desk-reference.csv',import.meta.url),'utf8');
    const result=await price(request({csv,markup:null},cookie));
    assert.equal(result.status,200);
    assert.equal((await result.json()).bid,14547);
    process.env.ESTIMATING_BOT_PASSCODE='rotated-unit-test-secret';
    assert.equal((await price(request({},cookie))).status,401);
  }finally{
    if(previous===undefined)delete process.env.ESTIMATING_BOT_PASSCODE;
    else process.env.ESTIMATING_BOT_PASSCODE=previous;
  }
});
