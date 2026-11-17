import {test,expect} from '@playwright/test';

test('outlined keynote is read locally and only edited text goes to the Groq function',async({page})=>{
  const fixture=process.env.A2Z_CA11231_PDF;
  test.skip(!fixture||process.env.A2Z_MOCK_GROQ!=='1','Set A2Z_CA11231_PDF and A2Z_MOCK_GROQ=1.');
  test.setTimeout(120000);
  const outside:string[]=[];
  page.on('request',req=>{if(/^https?:/.test(req.url())&&!req.url().startsWith('http://127.0.0.1:8765/'))outside.push(req.url());});
  await page.goto('/');
  await page.getByLabel('Passcode').fill('local-browser-test-only');
  await page.getByRole('button',{name:'Unlock'}).click();
  await page.getByTestId('upload').setInputFiles(fixture!);
  const sheets=page.getByRole('navigation',{name:'Sheets'}).getByRole('button');
  await expect(sheets).toHaveCount(53,{timeout:60000});
  await sheets.nth(18).click();
  await page.getByRole('button',{name:'Run sheet takeoff'}).click();
  const rows=page.locator('.measurements button');
  await expect(rows).toHaveCount(2,{timeout:30000});
  await rows.first().click();
  await page.getByText('Keynote advice',{exact:true}).click();
  await page.getByRole('button',{name:'Fit page'}).click();
  await page.getByRole('button',{name:'Read keynote area'}).click();
  const paper=page.getByTestId('paper');
  await expect(paper).toHaveAttribute('data-ready','true');
  const rect=(await paper.boundingBox())!;
  for(const [x,y] of [[2027,1191],[2360,1218]]){
    await page.mouse.click(rect.x+x*rect.width/2592,rect.y+y*rect.height/1728);
  }
  const excerpt=page.getByLabel('Keynote excerpt');
  await expect(excerpt).toHaveValue(/REMOVE ALL EXIST.*WALLS.*DOORS/i,{timeout:45000});
  const note='Remove walls unless they are marked for reuse.';
  await excerpt.fill(note);
  const submitted=page.waitForRequest('**/.netlify/functions/keynote');
  await page.getByRole('button',{name:'Send 1 note to Groq'}).click();
  expect((await submitted).postDataJSON()).toEqual({notes:[{object:'wall',note}]});
  await expect(page.getByTestId('keynote-advice')).toContainText('uncertain');
  await expect(rows).toHaveCount(2);
  await expect(page.getByText('0 approved',{exact:true})).toBeVisible();
  expect(outside).toEqual([]);
});
