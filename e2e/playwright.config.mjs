import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const e2eRoot = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
  testDir: e2eRoot,
  timeout: 15_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    reducedMotion: "reduce",
  },
  webServer: {
    command: "python3 -m http.server 4173",
    cwd: repoRoot,
    url: "http://127.0.0.1:4173/index.html",
    reuseExistingServer: false,
    timeout: 10_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    {
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
