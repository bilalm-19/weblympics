import { defineConfig } from "@playwright/test";

const baseURL = process.env.APP_URL ?? "http://localhost:8080";
// E2E_GPU=1 draws on the laptop's GPU (WSLg's D3D12 bridge needs a headed
// browser, so the windows appear on the desktop); CI keeps SwiftShader.
const gpu = process.env.E2E_GPU === "1";

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  use: {
    baseURL,
    ...(gpu ? { headless: false } : {}),
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        ...(gpu
          ? ["--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=gl"]
          : ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]),
      ],
    },
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1920, height: 1080 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: { command: "pnpm start", url: baseURL, reuseExistingServer: true },
});
