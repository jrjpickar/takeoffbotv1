import {test,expect} from '@playwright/test';
import type {} from './vectors-fixture';

test('dense hosted vectors preserve late geometry, sheet and document identity, and rendered pixels',async({page})=>{
  test.setTimeout(120000);
  await page.goto('/tests-vectors/vectors-fixture.html');
  await page.waitForFunction(()=>!!window.vectorTest);
  const r=await page.evaluate(()=>window.vectorTest.synthetic());
  expect(r.count).toBe(2);
  expect(r.firstPreviewEvent).toBe('preview');
  expect(r.lateGeometry).toBe(false);
  expect(r.scale).toMatchObject({feet:10,source:expect.stringMatching(/^Scale bar xref/)});
  expect(r.segments).toBe(15000);
  expect(r.curve).toEqual([['c',[[10,80],[20,75],[30,75],[40,80]]]]);
  expect(r.disconnected).toEqual([['l',[[10,60],[20,60]]],['l',[[35,60],[45,60]]]]);
  expect(r.lateStyle).toEqual({color:'#ff0000',dashed:true,items:[]});
  expect(r.first.marks).toEqual(expect.arrayContaining([
    expect.objectContaining({source:expect.stringMatching(/^Tagged annotation/),points:[[5,138],[25,138]]}),
    expect.objectContaining({scope:'wall',tool:'polyline',sheet:0,points:[[20,120],[70,120],[70,110]]}),
    expect.objectContaining({scope:'floor',tool:'polygon',sheet:0,points:expect.arrayContaining([[90,80],[110,60]])}),
  ]));
  expect(r.first.marks).toHaveLength(3);
  expect(r.first.warnings).toContain('unsupported geometry for wall. (2)');
  expect(r.second.marks).toContainEqual(expect.objectContaining({sheet:1,points:[[20,96],[70,96],[70,86]]}));
  expect(r.later.marks).toContainEqual(expect.objectContaining({sheet:0,points:[[20,108],[70,108],[70,98]]}));
  expect(r.revisit).toEqual(r.first);
  expect(r.render).toEqual({width:480,height:320,rgba:[51,127,204,255]});
  console.log(`500,000 background paints: index + bounded preview ${r.previewMs} ms, full takeoff ${r.takeoffMs} ms`);
});

test('cancels a queued preview and renders the active sheet before its preview',async({page})=>{
  await page.goto('/tests-vectors/vectors-fixture.html');
  await page.waitForFunction(()=>!!window.vectorTest);
  expect(await page.evaluate(()=>window.vectorTest.queuedPreviews())).toEqual(['render','preview']);
});

test('printed architectural and ratio scales require an unambiguous sheet scale',async({page})=>{
  await page.goto('/tests-vectors/vectors-fixture.html');
  await page.waitForFunction(()=>!!window.vectorTest);
  const r=await page.evaluate(()=>window.vectorTest.printed());
  expect(r.standalone).toMatchObject({feet:1,points:[[0,0],[18,0]]});
  expect(r.repeated).toEqual(expect.objectContaining({feet:1,points:[[0,0],[18,0]]}));
  expect(r.ratio).toMatchObject({feet:100/12,points:[[0,0],[72,0]]});
  expect(r.conflicting).toBeUndefined();
  expect(r.uncertain).toBeUndefined();
  expect(r.bareRatio).toBeUndefined();
});

test('supplied ZIP imports, extracts and renders all 105 sheets',async({page},info)=>{
  const fixture=process.env.A2Z_DL_ZIP;
  test.skip(!fixture,'Set A2Z_DL_ZIP to the supplied DL.zip.');
  test.setTimeout(600000);
  page.on('console',m=>{if(m.type()==='log')console.log(m.text());});
  await page.goto('/tests-vectors/vectors-fixture.html');
  await page.getByLabel('Plan archive').setInputFiles(fixture!);
  await page.waitForFunction(()=>!!window.vectorTest);
  const r=await page.evaluate(()=>window.vectorTest.exact());
  expect(r.bytes).toBe(114352721);
  expect(r.pages).toHaveLength(105);
  expect(r.pages.every(p=>p.png>1000&&Math.max(p.rasterWidth,p.rasterHeight)===1024)).toBe(true);
  for(const sheet of [6,8,11])expect(r.pages[sheet-1].snap).toBe(15000);
  expect(r.pages[5].scale).toMatch(/^Printed scale:/);
  expect(r.diagnosticMarks).toHaveLength(2);
  expect(r.diagnosticMarks).toContainEqual(expect.objectContaining({
    id:'auto-13-v313894',status:'review',points:[[2215.9344,1048.301],[2216.4296,1047.8058]],
  }));
  await info.attach('exact-plan-results',{body:JSON.stringify(r,null,2),contentType:'application/json'});
});
