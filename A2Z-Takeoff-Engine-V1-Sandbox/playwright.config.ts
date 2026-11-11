import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const data = mkdtempSync(join(tmpdir(),'a2z-e2e-'));
export default defineConfig({
  testDir:'tests',
  workers:1,
  use:{
    baseURL:'http://127.0.0.1:8765',
    viewport:{width:1440,height:1000},
    launchOptions:{executablePath:process.env.A2Z_CHROMIUM || undefined},
  },
  webServer:{
    command:'python -m uvicorn backend.main:app --host 127.0.0.1 --port 8765',
    env:{A2Z_DATA_DIR:data},
    url:'http://127.0.0.1:8765/api/projects',
    reuseExistingServer:false,
  },
});
