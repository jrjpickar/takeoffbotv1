import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sessionCookie} from '../netlify/auth.mjs';
import {handleKeynote} from '../netlify/sandbox-functions/keynote.mjs';

test('limits keynote input and rejects incomplete or invalid advice',async()=>{
  process.env.ESTIMATING_BOT_PASSCODE='keynote-test-passcode';
  delete process.env.GROQ_API_KEY;
  const cookie=sessionCookie(process.env.ESTIMATING_BOT_PASSCODE).split(';')[0];
  const request=(notes,authorize=true)=>new Request('https://example.test/.netlify/functions/keynote',{
    method:'POST',headers:authorize?{cookie}:{},body:JSON.stringify({notes}),
  });
  const notes=[{object:'wall',note:'Remove the wall.',planId:'never-forward'}];
  const noCall=()=>assert.fail('Unexpected provider call');
  assert.equal((await handleKeynote(request(notes,false),noCall)).status,401);
  assert.equal((await handleKeynote(request(notes),noCall)).status,503);
  process.env.GROQ_API_KEY='mock-only';
  assert.equal((await handleKeynote(request([{object:'wall',note:'x'.repeat(241)}]),noCall)).status,422);
  assert.equal((await handleKeynote(request(Array(6).fill(notes[0])),noCall)).status,422);
  const simulate=(finish,content)=>async(url,options)=>{
    assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');
    const body=JSON.parse(options.body);
    assert.deepEqual(JSON.parse(body.messages[1].content),[{id:'A',object:'wall',note:'Remove the wall.'}]);
    return Response.json({choices:[{finish_reason:finish,message:{content}}],usage:{total_tokens:42}});
  };
  assert.equal((await handleKeynote(request(notes),simulate('length','{"A":"remove"}'))).status,502);
  assert.equal((await handleKeynote(request(notes),simulate('stop','{"A":"approve"}'))).status,502);
  const response=await handleKeynote(request(notes),simulate('stop','{"A":"remove"}'));
  assert.deepEqual(await response.json(),{labels:['remove'],tokens:42});
});
