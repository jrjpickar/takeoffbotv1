import {test,expect} from '@playwright/test';

const fixture=process.env.A2Z_TUSTIN_PDF;
test.skip(!fixture,'Set A2Z_TUSTIN_PDF to the private Tustin PDF.');

test('Tustin demolition floor plan reads its scale and paired dashed partitions',async({page})=>{
  test.setTimeout(60000);
  await page.goto('/');
  await page.getByLabel('Passcode').fill('local-browser-test-only');
  await page.getByRole('button',{name:'Unlock'}).click();
  await expect(page.getByRole('button',{name:'Open sample'})).toBeEnabled();
  await page.getByTestId('upload').setInputFiles(fixture!);
  await expect(page.getByRole('navigation',{name:'Sheets'}).getByRole('button')).toHaveCount(48,{timeout:30000});
  await page.getByRole('searchbox',{name:'Search sheets'}).fill('D-1.0 demolition');
  await page.getByRole('button',{name:/^D-1\.0 DEMOLITION FLOOR PLAN/}).click();
  await expect(page.locator('.scale-status')).toContainText('Printed scale: 1/4');
  await page.getByRole('button',{name:'Run sheet takeoff'}).click();
  await expect(page.getByRole('status')).toHaveText('23 added for review.');
  await expect(page.locator('.measurements button')).toHaveCount(23);
  await expect(page.locator('.measurements button').first()).toContainText(/Interior walls.*LF/);
  await page.getByRole('button',{name:'Run sheet takeoff'}).click();
  await expect(page.getByRole('status')).toHaveText('0 added for review, 23 already present.');
});
