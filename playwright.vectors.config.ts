import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir:'tests-vectors',
  testMatch:'dense-vectors.spec.ts',
  workers:1,
  outputDir:'test-results-vectors',
  use:{baseURL:'http://127.0.0.1:8767',
    launchOptions:{executablePath:process.env.A2Z_CHROMIUM}},
  webServer:{
    command:'node tests-vectors/serve.mjs',
    url:'http://127.0.0.1:8767/tests-vectors/vectors-fixture.html',
  },
});
