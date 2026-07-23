const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    // Mirror the GitHub Pages project base (/skill-progression-coach/) so
    // relative asset paths resolve at the same depth as production.
    baseURL: 'http://127.0.0.1:8791/skill-progression-coach/',
    // In environments with a pre-provisioned Chromium (PW_CHROMIUM_PATH),
    // use it instead of downloading a matching browser build.
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  webServer: {
    command: 'node tests/serve.cjs',
    url: 'http://127.0.0.1:8791/skill-progression-coach/index.html',
    reuseExistingServer: true,
    timeout: 15000,
  },
});
