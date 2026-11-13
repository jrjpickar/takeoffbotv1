import {test,expect} from '@playwright/test';
const fixture=process.env.A2Z_LARGE_PDF;
test.skip(!fixture,'Set A2Z_LARGE_PDF to a near-1-GiB test PDF.');
test('one GiB range-backed PDF opens and renders',async({page})=>{
  test.setTimeout(120000);
  await page.goto('/');
  await page.getByLabel('Passcode').fill('local-browser-test-only');
  await page.getByRole('button',{name:'Unlock'}).click();
  await expect(page.getByRole('button',{name:'Open sample'})).toBeEnabled();
  await page.getByTestId('upload').setInputFiles(fixture!);
  await expect.poll(async()=>{const s=await page.locator('footer').innerText();return s.replace('Opening plans…','pending');},{timeout:20000}).toMatch(/Revision/);
  await expect(page.getByTestId('paper')).toHaveAttribute('data-ready','true',{timeout:100000});
  await page.getByRole('button',{name:'Run sheet takeoff'}).click();
  await expect(page.getByRole('status')).toHaveText('8 added for review.');
});
