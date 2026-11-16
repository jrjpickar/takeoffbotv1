import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';

const fixture=process.env.A2Z_TUSTIN_PDF;
test.skip(!fixture,'Set A2Z_TUSTIN_PDF to the private Tustin PDF.');

test('Tustin removal candidates retain their geometry and units through review and export',async({page})=>{
  test.setTimeout(90000);
  await page.goto('/');
  await page.getByLabel('Passcode').fill('local-browser-test-only');
  await page.getByRole('button',{name:'Unlock'}).click();
  await expect(page.getByRole('button',{name:'Open sample'})).toBeEnabled();
  await page.getByTestId('upload').setInputFiles(fixture!);
  const sheets=page.getByRole('navigation',{name:'Sheets'});
  await expect(sheets.getByRole('button')).toHaveCount(48,{timeout:30000});
  await page.getByRole('searchbox',{name:'Search sheets'}).fill('D-1.0 demolition');
  await sheets.getByRole('button',{name:/D-1\.0.*DEMOLITION FLOOR PLAN/i}).click();
  await expect(page.getByTestId('paper')).toHaveAttribute('data-ready','true',{timeout:30000});
  await expect(page.locator('.scale-status')).toContainText('Printed scale: 1/4');
  const run=page.getByRole('button',{name:'Run sheet takeoff'});
  await run.click();

  // Detector output for this private regression. STACK quantities are scored
  // independently and are never used as expected geometry.
  const scopes=[
    ['Interior walls',24,'LF','Demo interior stud walls','Ln Ft'],
    ['Doors',17,'EA','Remove doors','EA'],
    ['Fixtures',5,'EA','Remove plumbing fixtures','EA'],
    ['Millwork',1,'SF','Remove millwork','Sq Ft'],
    ['Blinds',2,'LF','Remove blinds','Ln Ft'],
  ] as const;
  const total=scopes.reduce((sum,[,count])=>sum+count,0);
  await expect(page.getByRole('status')).toHaveText(`${total} added for review.`);
  const mark=(scope:string)=>page.locator('.measurements').getByRole('button',{name:new RegExp(`^${scope} review`)});
  for(const [scope,count,unit] of scopes){
    await expect(mark(scope)).toHaveCount(count);
    await expect(mark(scope).first()).toContainText(new RegExp(` ${unit}$`));
  }

  await mark('Millwork').first().click();
  const assigned=page.getByLabel('Assigned scope');
  await assigned.selectOption('floor');
  await assigned.selectOption('millwork');
  await expect(mark('Millwork').first()).toContainText('edited');

  for(const [scope] of scopes){
    await mark(scope).first().click();
    await page.getByRole('button',{name:'Approve',exact:true}).click();
  }
  await expect(page.getByText('5 approved',{exact:true})).toBeVisible();

  await run.click();
  await expect(page.getByRole('status')).toHaveText(`0 added for review, ${total} already present.`);
  await expect(page.locator('.measurements button')).toHaveCount(total);
  await expect(page.getByText('5 approved',{exact:true})).toBeVisible();

  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download STACK CSV'}).click();
  const csv=readFileSync((await (await download).path())!,'utf8');
  const rows=csv.trim().split(/\r?\n/);
  expect(rows).toHaveLength(6);
  for(const [,,,name,unit] of scopes){
    expect(rows.find(row=>row.startsWith(name+','))).toContain(`,${unit},`);
  }
  expect(rows.find(row=>row.startsWith('Remove millwork,'))).toMatch(/,109\.973\d+,Sq Ft,/);
});
